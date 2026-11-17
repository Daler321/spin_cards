#!/usr/bin/env bash
# PreToolUse hook (Bash): wraps a plain test command so its output keeps only failures and errors,
# or a short summary when everything passed. The original exit code is preserved.
set -euo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")

# Only a single, plain test command; anything chained, piped or redirected runs untouched.
test_re='^[[:space:]]*(make[[:space:]]+(test|check)|pnpm[[:space:]]+(run[[:space:]]+)?test|pnpm[[:space:]]+(exec[[:space:]]+)?vitest|npx[[:space:]]+vitest|vitest)([[:space:]]|$)'
if ! [[ $cmd =~ $test_re ]] || [[ $cmd == *[\;\&\|\<\>\$\`]* ]]; then
  exit 0
fi

jq -c --arg cmd "$cmd" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: (.tool_input + {
      command: (
        "f=$(mktemp); bash -c " + ($cmd | @sh) + " >\"$f\" 2>&1; rc=$?; "
        + "sed -i.bak $'"'"'s/\\x1b\\[[0-9;]*m//g'"'"' \"$f\"; "
        + "if [ $rc -ne 0 ] || grep -qE '"'"'(FAIL|✗)'"'"' \"$f\"; then "
        + "grep -A 5 -E '"'"'(FAIL|Error|✗| error )'"'"' \"$f\" | head -100; "
        + "else echo \"OK: all checks passed\"; fi; "
        + "grep -E '"'"'^ *(Test Files|Tests) '"'"' \"$f\" | tail -2; "
        + "echo \"exit code: $rc\"; rm -f \"$f\" \"$f.bak\"; exit $rc"
      )
    })
  }
}' <<<"$input"
