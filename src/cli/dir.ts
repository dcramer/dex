import { getDexHome } from "../core/config.js";
import { getStoragePath } from "../core/storage/paths.js";

export function dirCommand(args: string[]): void {
  const isGlobal = args.includes("--global") || args.includes("-g");

  if (isGlobal) {
    console.log(getDexHome());
  } else {
    console.log(getStoragePath());
  }
}
