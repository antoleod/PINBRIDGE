# Firebase Functions (AI proxy)

This project uses a Firebase Function as a secure proxy for OpenAI so the API key is never shipped to browsers.

## Setup

1) Install dependencies:

`npm install --prefix functions`

2) Configure the OpenAI key as a Functions secret (stored in Google Secret Manager, encrypted at rest):

`firebase functions:secrets:set OPENAI_API_KEY`

3) Personal mode (no captcha/App Check): restrict who can call the endpoint by UID allowlist:

`firebase functions:secrets:set AI_ALLOWED_UIDS`

Set it to your UID (or multiple UIDs separated by commas/spaces). The function returns `UID_NOT_ALLOWED` otherwise.

4) Deploy:

`firebase deploy --only functions:generateCoachPack`

## Notes

- The endpoint requires:
  - Firebase Auth ID token (`Authorization: Bearer <idToken>`)
- Basic per-UID rate limit is enforced server-side.
