#!/bin/sh
# 一次性推送用 askpass：直连 github.com:443（绕 insteadOf）凭据供给
case "$1" in
  Username*) echo "tgfxpfgt" ;;
  Password*) exec gh auth token ;;
esac
