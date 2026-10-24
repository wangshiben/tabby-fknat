package nodeconfig

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Added to a temporary copy of the pinned SDK, so the release build tests the
// dependency it actually ships rather than an unrelated local SDK checkout.
func TestTabbyBillingKeyFileMode(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "billing.json")
	if err := os.WriteFile(filename, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := readBillingPrivateKeyFile(filename)
	if err == nil {
		t.Fatal("invalid billing JSON must still be rejected")
	}
	modeError := strings.Contains(err.Error(), "权限必须为 0600")
	if runtime.GOOS == "windows" && modeError {
		t.Fatalf("Windows synthesized permission bits must not reject the file: %v", err)
	}
	if runtime.GOOS != "windows" && !modeError {
		t.Fatalf("insecure Unix file permissions must still be rejected: %v", err)
	}
}
