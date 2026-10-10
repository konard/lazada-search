# Browser Commander 0.28.0 dependency audit

The fresh consumer dependency-resolution regression was reported on [existing issue #136](https://github.com/link-foundation/browser-commander/issues/136#issuecomment-6098863210). See [the structured receipt](dependency-audit.json) and [the published comment](upstream-136-comment.md).

A clean consumer resolves command-stream 1.6.2 and receives five high npm audit entries from one braces advisory. The installed ShellJS nesting guard rejected the controlled malicious pattern; an exploitable Browser Commander path was not demonstrated. An isolated command-stream 1.4.0 override removes the chain and audits clean, but compatibility with Browser Commander 0.28.0's new detached runner lifecycle has not been runtime-tested. No repository package changes or live browser requests were made for this audit.
