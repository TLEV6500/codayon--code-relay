import { startHarness } from "./packages/e2e/src/harness";

const harness = await startHarness();
const room = await harness.createRoom();

const view = await harness.openView();
const url = `${harness.baseUrl}/room/${room.code}?clientToken=${room.hostClientToken}`;
console.log("Navigating to:", url);

await view.navigate(url);

// Wait for page to load
await new Promise(resolve => setTimeout(resolve, 2000));

// Check page title
const title = await view.evaluate("document.title");
console.log("Page title:", title);

// Check if body exists
const hasBody = await view.evaluate("!!document.body");
console.log("Has body:", hasBody);

// Check if SessionControls selector exists
const sessionControlsSelector = '[data-testid="session-controls"]';
const hasSessionControls = await view.evaluate(
  `!!document.querySelector('${sessionControlsSelector}')`
);
console.log("Has SessionControls:", hasSessionControls);

// Debug: check what's actually in the DOM
const bodyHTML = await view.evaluate("document.body.innerHTML.substring(0, 500)");
console.log("Body HTML (first 500 chars):", bodyHTML);

view.close();
await harness.close();
