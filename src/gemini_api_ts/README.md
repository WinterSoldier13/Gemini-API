# Gemini API TypeScript

This is a TypeScript wrapper for the Google Gemini web app (formerly Bard). It allows you to interact with Gemini programmatically.

## Installation

```bash
npm install
```

## Usage

### Initialization

You need `__Secure-1PSID` and `__Secure-1PSIDTS` cookies from your browser (logged into gemini.google.com).

```typescript
import { GeminiClient } from "./client";

const secure1psid = "YOUR___Secure-1PSID";
const secure1psidts = "YOUR___Secure-1PSIDTS";

async function main() {
  const client = new GeminiClient(secure1psid, secure1psidts);
  await client.init({ verbose: true });

  const response = await client.generateContent("Hello, how are you?");
  console.log(response.text);
}

main();
```

### Chat Session

```typescript
const chat = client.startChat();
const response1 = await chat.sendMessage("Tell me a joke");
console.log(response1.text);

const response2 = await chat.sendMessage("Explain it");
console.log(response2.text);
```

### Image Generation

```typescript
const response = await client.generateContent("Generate an image of a cat");
console.log(response.images);
```

### File Upload

```typescript
const response = await client.generateContent("Describe this image", ["path/to/image.jpg"]);
console.log(response.text);
```

## Proxies

You can use a proxy by passing the `proxy` argument to the constructor.

```typescript
const client = new GeminiClient(secure1psid, secure1psidts, "http://user:pass@host:port");
```

## Disclaimer

This is an unofficial API and is not affiliated with Google. Use it at your own risk.
