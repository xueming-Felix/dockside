# Source record

```json
{
  "id": "cap_dab1ff6f-ebbf-4646-bb37-6172dbfa6272",
  "event": "outbound.message",
  "speaker": "assistant",
  "occurredAt": "2026-10-31T19:59:06.379Z",
  "sourceId": "cli_aa52cde0b578c08b:om_x100b6150c67b4ca1070bd6bf7d48793",
  "chatId": "oc_7ace179430b101be62241f34b1b98de1",
  "rootMessageId": "om_x100b61572c0548a10854d2bbb1c39f7",
  "sessionId": "4332cfec-a858-4479-8c4b-d385c1af51cd"
}
```

## Content

Confirmed: `STAGE=1 bun scripts/scenario.ts <actor> 60` is good to go. The flag was just verified at 300x on a throwaway cloud actor: 50/50 checks, all six alarms on their own (57 to 131 ms lag), and it left the clock frozen at 12:00 for the close. Pushed as 99bd8f9.
