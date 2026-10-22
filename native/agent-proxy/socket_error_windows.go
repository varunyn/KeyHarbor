//go:build windows

package main

import "syscall"

const connectionRefusedErrno = syscall.WSAECONNREFUSED
