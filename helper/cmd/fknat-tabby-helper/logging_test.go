package main

import (
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunLogDirectoryAcceptsConfigDirOverrides(t *testing.T) {
	configDir := filepath.Join(t.TempDir(), "custom-config")
	want := filepath.Join(configDir, runLogDirectory)
	if got := runLogDirectoryForArgs([]string{"doctor", "--config-dir", configDir}); got != want {
		t.Fatalf("runLogDirectoryForArgs() = %q, want %q", got, want)
	}
	if got := runLogDirectoryForArgs([]string{"doctor", "--config-dir=" + configDir}); got != want {
		t.Fatalf("runLogDirectoryForArgs(=) = %q, want %q", got, want)
	}
}

func TestStartRunLogCapturesStandardLogger(t *testing.T) {
	configDir := t.TempDir()
	previousDiagnosticWriter := diagnosticWriter
	previousStandardLogWriter := log.Writer()
	closeLog := startRunLog([]string{"doctor", "--config-dir", configDir})
	log.Print("standard logger entry")
	closeLog()
	diagnosticWriter = previousDiagnosticWriter
	log.SetOutput(previousStandardLogWriter)

	body, err := os.ReadFile(filepath.Join(configDir, runLogDirectory, runLogName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "standard logger entry") {
		t.Fatalf("active log = %q, want standard logger entry", body)
	}
}

func TestStartRunLogPersistsWhenProxyCommandHasClosedStderr(t *testing.T) {
	configDir := t.TempDir()
	closedStderr, err := os.CreateTemp(configDir, "closed-stderr")
	if err != nil {
		t.Fatal(err)
	}
	if err := closedStderr.Close(); err != nil {
		t.Fatal(err)
	}
	previousStderr := os.Stderr
	previousDiagnosticWriter := diagnosticWriter
	previousStandardLogWriter := log.Writer()
	os.Stderr = closedStderr
	defer func() {
		os.Stderr = previousStderr
		diagnosticWriter = previousDiagnosticWriter
		log.SetOutput(previousStandardLogWriter)
	}()

	closeLog := startRunLog([]string{"connect", "--config-dir", configDir})
	log.Print("stage=stdio_bridge_begin")
	fmt.Fprintln(diagnosticWriter, "FKNAT_ERROR code=TEST")
	closeLog()

	body, err := os.ReadFile(filepath.Join(configDir, runLogDirectory, runLogName))
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"command=connect", "stage=stdio_bridge_begin", "FKNAT_ERROR code=TEST", "FKNAT helper stop"} {
		if !strings.Contains(string(body), marker) {
			t.Errorf("log with closed stderr = %q, missing %q", body, marker)
		}
	}
}

func TestStartRunLogRotatesTenMiBLogOnNextStart(t *testing.T) {
	configDir := t.TempDir()
	logDirectory := filepath.Join(configDir, runLogDirectory)
	if err := os.MkdirAll(logDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	activePath := filepath.Join(logDirectory, runLogName)
	if err := os.WriteFile(activePath, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(activePath, runLogMaxBytes); err != nil {
		t.Fatal(err)
	}

	previousDiagnosticWriter := diagnosticWriter
	previousStandardLogWriter := log.Writer()
	closeLog := startRunLog([]string{"doctor", "--config-dir", configDir})
	closeLog()
	diagnosticWriter = previousDiagnosticWriter
	log.SetOutput(previousStandardLogWriter)

	archives, err := filepath.Glob(filepath.Join(logDirectory, runLogPrefix+"*"+runLogSuffix))
	if err != nil {
		t.Fatal(err)
	}
	if len(archives) != 1 {
		t.Fatalf("archive count = %d, want 1", len(archives))
	}
	activeInfo, err := os.Stat(activePath)
	if err != nil {
		t.Fatal(err)
	}
	if activeInfo.Size() >= runLogMaxBytes {
		t.Fatalf("active log size = %d, want less than %d", activeInfo.Size(), runLogMaxBytes)
	}
}

func TestRotateRunLogCompressesAndKeepsTenArchives(t *testing.T) {
	logDirectory := t.TempDir()
	activePath := filepath.Join(logDirectory, runLogName)
	for index := 0; index < runLogKeepCount+1; index++ {
		content := fmt.Sprintf("run-%d\n", index)
		if err := os.WriteFile(activePath, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		timestamp := time.Date(2026, time.January, 1, 0, 0, index, 0, time.UTC)
		if err := rotateRunLog(logDirectory, activePath, timestamp); err != nil {
			t.Fatal(err)
		}
	}
	archives, err := filepath.Glob(filepath.Join(logDirectory, runLogPrefix+"*"+runLogSuffix))
	if err != nil {
		t.Fatal(err)
	}
	if len(archives) != runLogKeepCount {
		t.Fatalf("archive count = %d, want %d", len(archives), runLogKeepCount)
	}
	if _, err := os.Stat(filepath.Join(logDirectory, "helper-20260101-000000.000000000.log.gz")); !os.IsNotExist(err) {
		t.Fatalf("oldest archive was not pruned: err=%v", err)
	}
	activeInfo, err := os.Stat(activePath)
	if err != nil {
		t.Fatal(err)
	}
	if activeInfo.Size() != 0 {
		t.Fatalf("active log size = %d, want 0", activeInfo.Size())
	}
	newest := filepath.Join(logDirectory, "helper-20260101-000010.000000000.log.gz")
	archive, err := os.Open(newest)
	if err != nil {
		t.Fatal(err)
	}
	decompressed, err := gzip.NewReader(archive)
	if err != nil {
		_ = archive.Close()
		t.Fatal(err)
	}
	body, err := io.ReadAll(decompressed)
	_ = decompressed.Close()
	_ = archive.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "run-10") {
		t.Fatalf("newest archive body = %q, want run-10", body)
	}
}
