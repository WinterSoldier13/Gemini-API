import { logger } from "./logger";

export function getNestedValue(
  data: any,
  path: number[],
  defaultValue: any = null
): any {
  let current = data;

  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    try {
      if (current === null || current === undefined) {
        throw new Error("Current is null or undefined");
      }
      current = current[key];
    } catch (e) {
      let currentRepr = "";
      try {
        currentRepr = JSON.stringify(current);
        if (currentRepr && currentRepr.length > 200) {
          currentRepr = currentRepr.substring(0, 197) + "...";
        }
      } catch (err) {
        currentRepr = "Unserializable";
      }

      logger.debug(
        `Safe navigation: path ${JSON.stringify(path)} ended at index ${i} (key '${key}'), ` +
          `returning default. Context: ${currentRepr}`
      );
      return defaultValue;
    }
  }

  if (current === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  return current;
}

export function extractJsonFromResponse(text: string): any[] {
  if (typeof text !== "string") {
    throw new TypeError(
      `Input text is expected to be a string, got ${typeof text} instead.`
    );
  }

  // Find the first line which is valid JSON
  const lines = text.split("\n");
  for (const line of lines) {
    try {
      return JSON.parse(line.trim());
    } catch (e) {
      continue;
    }
  }

  throw new Error(
    "Could not find a valid JSON object or array in the response."
  );
}
