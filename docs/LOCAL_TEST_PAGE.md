# Local Audio Test Page

This project now includes a localhost test page using `HNWT8H9D.mp3`.

## 1) Start extension dev mode

```bash
npm run dev
```

## 2) Start ASR gateway

Use the mock gateway (for end-to-end wiring validation):

```bash
npm run gateway:mock
```

If you need real ASR quality, replace the gateway with your real service.

## 3) Start test page server

```bash
npm run test:page
```

Then open:

`http://127.0.0.1:5179/local-audio-test.html`

## 4) Run test

1. Open extension popup and ensure ASR mode is `online-gateway`.
2. Click `Play Audio` on the test page.
3. Verify subtitle overlay updates in realtime.

## Notes

- The local test content script only activates on:
  - `http(s)://localhost/*`
  - `http(s)://127.0.0.1/*`
- The page must include `data-linguarelay-test-page` on `<html>`.
