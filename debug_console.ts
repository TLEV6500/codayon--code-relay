import { startHarness } from "./packages/e2e/src/harness";

const harness = await startHarness();
const room = await harness.createRoom();

const view = await harness.openView();
const url = `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`;
console.log("Navigating to:", url);

await view.navigate(url);

// Wait for page to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Check console for errors
const hasErrors = await view.evaluate(`
  !!window.__errors ||
  !!document.querySelector('[data-testid="error"]') ||
  !!document.querySelector('.error')
`);
console.log("Has error indicators:", hasErrors);

// Check what page we're on (look for specific text)
const pageText = await view.evaluate("document.body.innerText.substring(0, 200)");
console.log("Page text:", pageText);

// Check if we can see the input fields (lobby) vs editor (room)
const hasCodeMirror = await view.evaluate("!!document.querySelector('.cm-editor')");
console.log("Has CodeMirror (room view):", hasCodeMirror);

const hasLobbyInput = await view.evaluate("!!document.querySelector('input[placeholder]')");
console.log("Has lobby input:", hasLobbyInput);

view.close();
await harness.close();
