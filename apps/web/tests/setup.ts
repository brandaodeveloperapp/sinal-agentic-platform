import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement scrollIntoView; the message list calls it to follow the stream.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
