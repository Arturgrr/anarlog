```bash
cargo run \
  --example manual \
  -p dictation-ui-macos \
  --features="examples"
```

Pass `-- bottom`, `-- hidden` or `-- notch` to try another position of the
dictation indicator; `notch` shows the notch indicator on a MacBook with a
notch and the top position elsewhere.
