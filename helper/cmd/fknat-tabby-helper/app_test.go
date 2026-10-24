package main

import (
	"errors"
	"testing"
)

func TestClassifyDistinguishesRouteFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "route rejected", err: errors.New("stage=dial_route: client: route rejected code=1"), want: "ROUTE_REJECTED"},
		{name: "route timeout", err: errors.New("stage=dial_route: context deadline exceeded"), want: "ROUTE_UNAVAILABLE"},
		{name: "target dial timeout", err: errors.New("dial target: context deadline exceeded"), want: "SERVER_OFFLINE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classify(test.err); got != test.want {
				t.Fatalf("classify(%q) = %q, want %q", test.err, got, test.want)
			}
		})
	}
}
