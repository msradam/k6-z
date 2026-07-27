package main

import (
	"go.k6.io/k6/v2/cmd"

	_ "github.com/grafana/xk6-ssh"
)

func main() { cmd.Execute() }
