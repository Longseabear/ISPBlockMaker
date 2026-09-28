# Request user crops and await delivery

Use when analysis needs the user's choice of neutral patches, defects, or input regions. Explain the purpose in the request; do not invent ROIs or send crops on the user's behalf.

Open the image with `isp viewer-open FILE --spec SPEC.json` first when RAW conditions are needed. Use its image ID:

```sh
isp viewer-request IMAGE_ID --message "WB 계산용 중성 회색 영역을 선택하고 추가 → 전달해주세요." --purpose white_balance
isp viewer-wait REQUEST_ID
```

The workspace terminal supplies `isp`. Outside that shell use `node .isp/tools/isp.mjs` in the workspace. `viewer-request` creates an agent-marked request, shows the Viewer and writes its request ID to stderr before waiting. By default it keeps long polling until delivery or cancellation. Use `--no-wait` only when intentionally registering a request to await later. `viewer-wait` never creates another request or moves the user's view.

This is HTTP long polling: the server holds the response and wakes it when the user sends crops or cancels. It does not inject text into the terminal or start a new agent. Keep the terminal tool process running. If the tool yields a running process handle, poll that same handle until it finishes; do not end the agent turn with a final answer while awaiting the crop. Send a brief progress message as appropriate. A yielded process handle is not a completed request. Do not start another request or wait process while the existing one is running. Stop the process if the user cancels or changes the task.

- `fulfilled`: use `delivery.inputs[]` for every grouped ROI, exact binary path and spec, plus shared/per-item notes. Only explicitly sent crops count; drawing or adding alone does not fulfill a request.
- `pending`, `timedOut: true`: returned only when you explicitly chose a finite `--wait SECONDS` budget. The default continuous mode handles server timeouts internally. If a finite wait was intended, keep the user informed, then wait again on that ID while the task still needs their selection. Never recreate the request on timeout. Stop waiting if the user changes the task or asks to stop.
- `cancelled`: stop this flow; do not recreate automatically.
- `workspace_changed`, `missing`, `unavailable`, HTTP/network errors: stop and inspect the current workspace/request. Do not blindly resend creation after an uncertain response; `isp viewer` lists existing requests.

Default CLI waiting is continuous; each HTTP request lasts up to 55 seconds and is automatically renewed on pending. Optional `--wait SECONDS` limits the whole command to 0–600 seconds; `--wait 0` is a single status check. Do not add a finite wait limit to the normal ask-and-resume workflow. A server restart disconnects active waits; the persisted request and delivery can be read again with the same ID. Later unrelated deliveries cannot replace this request's reply. Reading does not consume the delivery. If its files were deleted, `unavailable` is returned; ask for a new selection rather than using guessed data.

Process locally; never print image bytes/base64 into context. For latest-delivery stats/ack commands first verify `isp viewer-crops` still has the returned delivery ID (those endpoints intentionally guard against superseded deliveries). Otherwise process the returned input paths directly and report the result without acknowledging another delivery. Apply the existing crop-analysis guidance for WB and reference-I/O guidance for storing inputs.

`viewer-result REQUEST_ID` is a snapshot of saved items. It does not wait. `viewer-result REQUEST_ID --wait SECONDS` now waits for explicit delivery, but prefer `viewer-wait REQUEST_ID` for the continuous workflow. A saved/submitted crop is not a sent reply.
