package main

import (
	"go.k6.io/k6/cmd"

	_ "github.com/grafana/xk6-exec"
	_ "github.com/grafana/xk6-ssh"
	_ "github.com/msradam/xk6-tn3270"
)

func main() { cmd.Execute() }
