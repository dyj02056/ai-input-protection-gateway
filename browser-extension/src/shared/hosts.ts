import { SUPPORTED_HOSTS } from "./constants.ts";

export function hostnameOf(rawUrl: string | undefined): string {
  if (!rawUrl) return "";
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

export function isSupportedUrl(rawUrl: string | undefined): boolean {
  const hostname = hostnameOf(rawUrl);
  if (hostname === "") return false;
  return SUPPORTED_HOSTS.some((host) => hostname === host || hostname.endsWith("." + host));
}
