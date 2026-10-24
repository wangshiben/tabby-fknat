package main

import (
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	runLogDirectory = "logs"
	runLogName      = "helper.log"
	runLogPrefix    = "helper-"
	runLogSuffix    = ".log.gz"
	runLogMaxBytes  = 10 * 1024 * 1024
	runLogKeepCount = 10
)

var diagnosticWriter io.Writer = os.Stderr

// ProxyCommand hosts may not provide a usable stderr handle. Persist the log
// independently so a failed console write cannot discard diagnostics on disk.
type runLogWriter struct {
	file   io.Writer
	stderr io.Writer
}

func (writer runLogWriter) Write(data []byte) (int, error) {
	n, err := writer.file.Write(data)
	_, _ = writer.stderr.Write(data)
	return n, err
}

// startRunLog opens the append-only diagnostic log for this helper invocation.
// Rotation is done before opening the active file so a previous process cannot
// keep the file open while it is being compressed on Windows.
func startRunLog(args []string) func() {
	logDirectory := runLogDirectoryForArgs(args)
	if err := os.MkdirAll(logDirectory, 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "fknat-helper: logging disabled: create log directory: %v\n", err)
		return func() {}
	}
	if err := os.Chmod(logDirectory, 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "fknat-helper: logging disabled: secure log directory: %v\n", err)
		return func() {}
	}
	activePath := filepath.Join(logDirectory, runLogName)
	if info, err := os.Stat(activePath); err == nil && info.Size() >= runLogMaxBytes {
		if err := rotateRunLog(logDirectory, activePath, time.Now().UTC()); err != nil {
			fmt.Fprintf(os.Stderr, "fknat-helper: log rotation failed: %v\n", err)
		}
	} else if err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "fknat-helper: log rotation check failed: %v\n", err)
	}

	file, err := os.OpenFile(activePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fknat-helper: logging disabled: open log: %v\n", err)
		return func() {}
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		fmt.Fprintf(os.Stderr, "fknat-helper: logging disabled: secure log file: %v\n", err)
		return func() {}
	}
	diagnosticWriter = runLogWriter{file: file, stderr: os.Stderr}
	previousStandardLogWriter := log.Writer()
	log.SetOutput(diagnosticWriter)
	_, _ = fmt.Fprintf(diagnosticWriter, "\n=== FKNAT helper start %s command=%s pid=%d ===\n", time.Now().UTC().Format(time.RFC3339Nano), commandName(args), os.Getpid())
	return func() {
		_, _ = fmt.Fprintf(diagnosticWriter, "=== FKNAT helper stop %s ===\n", time.Now().UTC().Format(time.RFC3339Nano))
		log.SetOutput(previousStandardLogWriter)
		_ = file.Close()
	}
}

func commandName(args []string) string {
	if len(args) == 0 || strings.TrimSpace(args[0]) == "" {
		return "unknown"
	}
	return strings.TrimSpace(args[0])
}

func runLogDirectoryForArgs(args []string) string {
	base, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(base) == "" {
		base = os.TempDir()
	}
	configDirectory := filepath.Join(base, "tabby-fknat")
	for index := 1; index < len(args); index++ {
		argument := args[index]
		switch {
		case argument == "--config-dir" && index+1 < len(args):
			if value := strings.TrimSpace(args[index+1]); value != "" {
				configDirectory = value
			}
			index++
		case strings.HasPrefix(argument, "--config-dir="):
			if value := strings.TrimSpace(strings.TrimPrefix(argument, "--config-dir=")); value != "" {
				configDirectory = value
			}
		}
	}
	return filepath.Join(configDirectory, runLogDirectory)
}

func rotateRunLog(logDirectory, activePath string, timestamp time.Time) error {
	archivePath, err := nextArchivePath(logDirectory, timestamp)
	if err != nil {
		return err
	}
	if err := compressRunLog(activePath, archivePath); err != nil {
		return err
	}
	return pruneRunLogArchives(logDirectory)
}

func nextArchivePath(logDirectory string, timestamp time.Time) (string, error) {
	stamp := timestamp.UTC().Format("20060102-150405.000000000")
	base := filepath.Join(logDirectory, runLogPrefix+stamp+runLogSuffix)
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return base, nil
	} else if err != nil {
		return "", err
	}
	for suffix := 1; suffix < 1000; suffix++ {
		candidate := filepath.Join(logDirectory, fmt.Sprintf("%s-%03d%s", runLogPrefix+stamp, suffix, runLogSuffix))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("unable to allocate a log archive name")
}

func compressRunLog(activePath, archivePath string) error {
	input, err := os.Open(activePath)
	if err != nil {
		return fmt.Errorf("open active log: %w", err)
	}
	output, err := os.OpenFile(archivePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		_ = input.Close()
		return fmt.Errorf("create compressed log: %w", err)
	}
	compressed := gzip.NewWriter(output)
	_, copyErr := io.Copy(compressed, input)
	closeGzipErr := compressed.Close()
	closeOutputErr := output.Close()
	closeInputErr := input.Close()
	if copyErr != nil || closeGzipErr != nil || closeOutputErr != nil || closeInputErr != nil {
		_ = os.Remove(archivePath)
		if copyErr != nil {
			return fmt.Errorf("compress active log: %w", copyErr)
		}
		if closeGzipErr != nil {
			return fmt.Errorf("finish compressed log: %w", closeGzipErr)
		}
		if closeOutputErr != nil {
			return fmt.Errorf("close compressed log: %w", closeOutputErr)
		}
		return fmt.Errorf("close active log: %w", closeInputErr)
	}
	if err := os.Truncate(activePath, 0); err != nil {
		return fmt.Errorf("truncate active log after compression: %w", err)
	}
	return nil
}

func pruneRunLogArchives(logDirectory string) error {
	entries, err := os.ReadDir(logDirectory)
	if err != nil {
		return fmt.Errorf("read log directory: %w", err)
	}
	archives := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), runLogPrefix) || !strings.HasSuffix(entry.Name(), runLogSuffix) {
			continue
		}
		archives = append(archives, entry)
	}
	sort.Slice(archives, func(left, right int) bool {
		return archives[left].Name() < archives[right].Name()
	})
	for len(archives) > runLogKeepCount {
		if err := os.Remove(filepath.Join(logDirectory, archives[0].Name())); err != nil {
			return fmt.Errorf("remove old compressed log %s: %w", archives[0].Name(), err)
		}
		archives = archives[1:]
	}
	return nil
}
