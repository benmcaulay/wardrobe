/** When false (default), upload does not reverse-image search or pre-fill fields from web matches. */
export function webMatchAutofillEnabled(): boolean {
  return process.env.ENABLE_WEB_MATCH_AUTOFILL === "true";
}
