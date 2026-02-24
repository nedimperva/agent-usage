import { describe, expect, it } from "vitest";
import { extractAntigravityConnectionFromCommandLine } from "../src/providers/antigravity";

describe("extractAntigravityConnectionFromCommandLine", () => {
  it("extracts csrf token and port from windows language-server args", () => {
    const parsed = extractAntigravityConnectionFromCommandLine(
      `"C:\\path\\language_server_windows_x64.exe" --enable_lsp --extension_server_port 10442 --csrf_token ace6bd61-67d0-4721-880f-8f0a0a262a0b`,
    );

    expect(parsed.port).toBe(10442);
    expect(parsed.csrfToken).toBe("ace6bd61-67d0-4721-880f-8f0a0a262a0b");
  });

  it("supports equals-style flags", () => {
    const parsed = extractAntigravityConnectionFromCommandLine(
      `language_server_macos --extension_server_port=9876 --csrf_token="token-abc-123"`,
    );

    expect(parsed.port).toBe(9876);
    expect(parsed.csrfToken).toBe("token-abc-123");
  });
});
