package main

// fknat-tabby-helper is the small native bridge used by Tabby's SSH
// ProxyCommand.  Its stdout is reserved for the SSH byte stream; diagnostics
// and structured errors always go to stderr.

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wangshiben/fknat/pkg/client"
	"github.com/wangshiben/fknat/pkg/node"
)

const (
	protocolVersion = 1
)

// Release builds set this from package.json with -X main.helperVersion.
var helperVersion = "development"

type options struct {
	billingKey string
	configDir  string
	identity   string
	serverID   string
	timeout    time.Duration
}

type doctorResult struct {
	OK            bool   `json:"ok"`
	HelperVersion string `json:"helper_version"`
	Protocol      int    `json:"protocol_version"`
	NetworkStatus string `json:"network_status"`
	RelayAddress  string `json:"relay_address,omitempty"`
	Route         bool   `json:"route_available,omitempty"`
}

func main() {
	closeLog := startRunLog(os.Args[1:])
	exitCode := 0
	defer func() {
		closeLog()
		if exitCode != 0 {
			os.Exit(exitCode)
		}
	}()
	if len(os.Args) < 2 {
		fail("INVALID_ARGUMENT", errors.New("a command is required (version, doctor, or connect)"))
		exitCode = 1
		return
	}
	var err error
	switch os.Args[1] {
	case "version":
		err = runVersion(os.Args[2:])
	case "doctor":
		err = runDoctor(os.Args[2:])
	case "connect":
		err = runConnect(os.Args[2:])
	default:
		fail("INVALID_ARGUMENT", fmt.Errorf("unknown command %q", os.Args[1]))
		exitCode = 1
		return
	}
	if err != nil {
		fail(classify(err), err)
		exitCode = 1
	}
}

func runVersion(args []string) error {
	flags := flag.NewFlagSet("version", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	jsonOutput := flags.Bool("json", false, "write JSON output")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if *jsonOutput {
		return writeJSON(map[string]any{
			"helper_version":   helperVersion,
			"protocol_version": protocolVersion,
			"fknat_version":    "shared-client-api-v1",
		})
	}
	_, err := fmt.Fprintln(os.Stdout, helperVersion)
	return err
}

func runDoctor(args []string) error {
	opts, err := parseOptions("doctor", args, false)
	if err != nil {
		return err
	}
	logStage("doctor_options", opts)
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()
	identity, err := prepareIdentity(ctx, opts)
	if err != nil {
		return withStage("identity_prepare", err)
	}
	log.Printf("stage=identity_ready node_id=%s ca_url=%s", redactNodeID(identity.NodeID), identity.CAURL)
	result := doctorResult{
		OK:            true,
		HelperVersion: helperVersion,
		Protocol:      protocolVersion,
		NetworkStatus: "online",
	}
	if opts.serverID == "" {
		log.Printf("stage=index_discovery_begin")
		result.RelayAddress, err = node.DiscoverIndex(ctx, identity.CAURL)
		if err != nil {
			return withStage("index_discovery", err)
		}
		log.Printf("stage=index_discovery_ready relay=%s", result.RelayAddress)
	} else {
		log.Printf("stage=client_create_begin server_id=%s", redactNodeID(opts.serverID))
		fknatClient, err := newClient(opts, identity)
		if err != nil {
			return withStage("client_create", err)
		}
		defer fknatClient.Close()
		log.Printf("stage=client_start_begin server_id=%s", redactNodeID(opts.serverID))
		if err := fknatClient.Start(ctx); err != nil {
			return withStage("client_start", err)
		}
		result.RelayAddress = fknatClient.Status().RelayAddress
		log.Printf("stage=client_start_ready relay=%s network_status=%s", result.RelayAddress, fknatClient.Status().NetworkStatus)
		log.Printf("stage=dial_route_begin route=0 server_id=%s", redactNodeID(opts.serverID))
		stream, err := fknatClient.DialTCP(ctx, 0)
		if err != nil {
			return withStage("dial_route", err)
		}
		result.Route = true
		log.Printf("stage=dial_route_ready route=0 server_id=%s", redactNodeID(opts.serverID))
		_ = stream.Close()
	}
	log.Printf("stage=doctor_complete ok=%t route_available=%t", result.OK, result.Route)
	return writeJSON(result)
}

func runConnect(args []string) error {
	opts, err := parseOptions("connect", args, true)
	if err != nil {
		return err
	}
	logStage("connect_options", opts)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	setupExpired := make(chan struct{})
	setupTimer := time.AfterFunc(opts.timeout, func() {
		close(setupExpired)
		cancel()
	})
	identity, err := prepareIdentity(ctx, opts)
	if err != nil {
		setupTimer.Stop()
		return withStage("identity_prepare", err)
	}
	log.Printf("stage=identity_ready node_id=%s ca_url=%s", redactNodeID(identity.NodeID), identity.CAURL)
	log.Printf("stage=client_create_begin server_id=%s", redactNodeID(opts.serverID))
	fknatClient, err := newClient(opts, identity)
	if err != nil {
		setupTimer.Stop()
		return withStage("client_create", err)
	}
	defer fknatClient.Close()
	log.Printf("stage=client_start_begin server_id=%s", redactNodeID(opts.serverID))
	if err := fknatClient.Start(ctx); err != nil {
		setupTimer.Stop()
		if channelClosed(setupExpired) {
			return withStage("client_start", fmt.Errorf("connection setup timed out after %s: %w", opts.timeout, err))
		}
		return withStage("client_start", err)
	}
	log.Printf("stage=client_start_ready relay=%s network_status=%s", fknatClient.Status().RelayAddress, fknatClient.Status().NetworkStatus)
	log.Printf("stage=dial_route_begin route=0 server_id=%s", redactNodeID(opts.serverID))
	stream, err := fknatClient.DialTCP(ctx, 0)
	if err != nil {
		setupTimer.Stop()
		if channelClosed(setupExpired) {
			return withStage("dial_route", fmt.Errorf("connection setup timed out after %s: %w", opts.timeout, err))
		}
		return withStage("dial_route", err)
	}
	setupTimer.Stop()
	log.Printf("stage=dial_route_ready route=0 server_id=%s", redactNodeID(opts.serverID))
	log.Printf("stage=stdio_bridge_begin")
	err = bridgeStdio(stream)
	if err != nil {
		log.Printf("stage=stdio_bridge_failed error=%q", err.Error())
		return withStage("stdio_bridge", err)
	}
	log.Printf("stage=stdio_bridge_complete")
	return nil
}

type stagedError struct {
	stage string
	err   error
}

func (err stagedError) Error() string {
	return fmt.Sprintf("stage=%s: %v", err.stage, err.err)
}

func (err stagedError) Unwrap() error { return err.err }

func withStage(stage string, err error) error {
	if err == nil {
		return nil
	}
	if _, ok := err.(stagedError); ok {
		return err
	}
	return stagedError{stage: stage, err: err}
}

func logStage(stage string, opts options) {
	log.Printf("stage=%s config_dir=%s server_id=%s timeout=%s", stage, opts.configDir, redactNodeID(opts.serverID), opts.timeout)
}

func redactNodeID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 16 {
		return value
	}
	return value[:8] + "…" + value[len(value)-8:]
}

func channelClosed(channel <-chan struct{}) bool {
	select {
	case <-channel:
		return true
	default:
		return false
	}
}

func parseOptions(name string, args []string, requireServer bool) (options, error) {
	defaults, err := defaultOptions()
	if err != nil {
		return options{}, err
	}
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&defaults.billingKey, "billing-key", defaults.billingKey, "override the billing key file")
	flags.StringVar(&defaults.configDir, "config-dir", defaults.configDir, "override the FKNAT data directory")
	flags.StringVar(&defaults.identity, "identity", defaults.identity, "override the persistent identity file")
	flags.StringVar(&defaults.serverID, "server-id", defaults.serverID, "target FKNAT Address")
	flags.DurationVar(&defaults.timeout, "timeout", defaults.timeout, "connection timeout")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if flags.NArg() != 0 {
		return options{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	defaults.billingKey = strings.TrimSpace(defaults.billingKey)
	defaults.configDir = strings.TrimSpace(defaults.configDir)
	defaults.identity = strings.TrimSpace(defaults.identity)
	defaults.serverID = strings.TrimSpace(defaults.serverID)
	if defaults.billingKey == "" {
		defaults.billingKey = filepath.Join(defaults.configDir, "secrets", "billing.json")
	}
	if defaults.identity == "" {
		defaults.identity = filepath.Join(defaults.configDir, "client.identity")
	}
	if defaults.timeout <= 0 {
		return options{}, errors.New("timeout must be greater than zero")
	}
	if requireServer && defaults.serverID == "" {
		return options{}, errors.New("--server-id is required")
	}
	return defaults, nil
}

func defaultOptions() (options, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return options{}, fmt.Errorf("locate user config directory: %w", err)
	}
	configDir := filepath.Join(base, "tabby-fknat")
	return options{configDir: configDir, identity: filepath.Join(configDir, "client.identity"), timeout: 30 * time.Second}, nil
}

func prepareIdentity(ctx context.Context, opts options) (*node.Identity, error) {
	return node.Prepare(ctx, node.CommonConfig{
		BillingKeyFile:  opts.billingKey,
		IdentityFile:    opts.identity,
		SecurityProfile: node.SecurityProduction,
	})
}

func newClient(opts options, identity *node.Identity) (*client.Client, error) {
	return client.New(client.Config{
		Common: node.CommonConfig{
			BillingKeyFile:      identity.BillingKeyFile,
			BillingSnapshotFile: identity.BillingSnapshotFile,
			IdentityFile:        identity.IdentityFile,
			SecurityProfile:     identity.SecurityProfile,
		},
		ServerNodeID:   opts.serverID,
		DialAttempts:   12,
		RetryDelay:     3 * time.Second,
		ReconnectDelay: 3 * time.Second,
		Logger:         log.New(diagnosticWriter, "", log.LstdFlags),
	})
}

func bridgeStdio(stream net.Conn) error {
	defer stream.Close()
	inputDone := make(chan error, 1)
	outputDone := make(chan error, 1)
	go func() {
		_, err := io.Copy(stream, os.Stdin)
		if closer, ok := stream.(interface{ CloseWrite() error }); ok {
			if closeErr := closer.CloseWrite(); err == nil {
				err = closeErr
			}
		}
		inputDone <- normalizeCopyError(err)
	}()
	go func() {
		_, err := io.Copy(os.Stdout, stream)
		outputDone <- normalizeCopyError(err)
	}()
	select {
	case err := <-outputDone:
		_ = stream.Close()
		return err
	case err := <-inputDone:
		if err != nil {
			_ = stream.Close()
			return err
		}
		return normalizeCopyError(<-outputDone)
	}
}

func normalizeCopyError(err error) error {
	if err == nil || errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}

func classify(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "invalid server node id"), strings.Contains(message, "invalid node id"):
		return "ADDRESS_INVALID"
	case strings.Contains(message, "billing key"), strings.Contains(message, "billing_key"), strings.Contains(message, "billing authorization"):
		return "BILLING_KEY_INVALID"
	case strings.Contains(message, "identity"):
		return "IDENTITY_ERROR"
	case strings.Contains(message, "discover index"), strings.Contains(message, "index directory"):
		return "DISCOVERY_FAILED"
	case strings.Contains(message, "route rejected"):
		return "ROUTE_REJECTED"
	case strings.Contains(message, "stage=dial_route"):
		return "ROUTE_UNAVAILABLE"
	case strings.Contains(message, "dial") || strings.Contains(message, "eof") || strings.Contains(message, "context deadline"):
		return "SERVER_OFFLINE"
	default:
		return "INTERNAL_ERROR"
	}
}

func writeJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	return encoder.Encode(value)
}

func fail(code string, err error) {
	if err == nil {
		err = errors.New("unknown error")
	}
	fmt.Fprintf(diagnosticWriter, "FKNAT_ERROR code=%s message=%q\n", code, err.Error())
}
