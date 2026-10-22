//go:build windows

package main

import "syscall"

// WSAECONNREFUSED is defined by Winsock but is not exported by Go syscall.
// https://learn.microsoft.com/en-us/windows/win32/winsock/windows-sockets-error-codes-2
const connectionRefusedErrno = syscall.Errno(10061)
