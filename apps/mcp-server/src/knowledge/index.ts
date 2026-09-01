import { HashingEmbedder } from "./embeddings.js";
import { VectorStore, type Document } from "./vectorStore.js";

/**
 * Fictional Onda Telecom policy and FAQ knowledge base. This is public,
 * non-customer information, so the tool that searches it is available to any
 * authenticated caller (scope catalog:read), unlike the customer-data tools.
 */
export const KNOWLEDGE_DOCUMENTS: Document[] = [
  {
    id: "kb-roaming",
    title: "International roaming",
    text: "International roaming is disabled by default. Enable it in the app before you travel. A daily roaming pass covers 1GB of data and unlimited on-net calls for a flat fee; without a pass, roaming data is billed per megabyte.",
  },
  {
    id: "kb-pay-invoice",
    title: "Paying an invoice",
    text: "You can pay an invoice by Pix, credit card or the printed barcode. Payment clears within one business day. An overdue invoice can suspend the line after fifteen days; paying the overdue amount reactivates it automatically.",
  },
  {
    id: "kb-plan-change",
    title: "Changing your plan",
    text: "You can change your plan once per billing cycle. An upgrade takes effect immediately and is charged pro rata; a downgrade takes effect at the start of the next cycle. Changing the plan does not change your phone number.",
  },
  {
    id: "kb-data-rollover",
    title: "Data rollover",
    text: "Unused data does not roll over to the next cycle on Control plans. On Post and Max plans, up to 20GB of unused data rolls over for one cycle. Rollover data is consumed before the current cycle allowance.",
  },
  {
    id: "kb-coverage",
    title: "Network coverage and signal",
    text: "Coverage is nationwide on 4G and expanding on 5G in capital cities. If you have no signal, restart the phone and check that airplane mode is off. Persistent signal loss in one area should be reported as a network support ticket.",
  },
  {
    id: "kb-sim-swap",
    title: "Lost phone and SIM swap",
    text: "If your phone is lost or stolen, suspend the line immediately in the app or by contacting support. A SIM swap moves your number to a new SIM and requires identity verification. The old SIM stops working as soon as the swap completes.",
  },
  {
    id: "kb-esim",
    title: "eSIM activation",
    text: "Compatible phones can activate an eSIM by scanning a QR code from the app. An eSIM and a physical SIM can hold two numbers on one device. Activating an eSIM does not cancel your physical SIM unless you ask for it.",
  },
  {
    id: "kb-cancel",
    title: "Cancelling the service",
    text: "You can cancel at any time with no fee on prepaid plans. Postpaid plans require a request through support and settle any open invoice on cancellation. Number portability lets you keep your number when moving to another carrier.",
  },
];

export function buildKnowledgeBase(): VectorStore {
  const store = new VectorStore(new HashingEmbedder());
  store.add(KNOWLEDGE_DOCUMENTS);
  return store;
}
