import { promises as fs } from "fs";
import path from "path";

describe("TESTNET documentation", () => {
  const docPath = path.resolve(__dirname, "../docs/TESTNET.md");

  test("documentation file exists", async () => {
    await expect(fs.access(docPath)).resolves.toBeUndefined();
  });

  test("contains faucet funding section", async () => {
    const content = await fs.readFile(docPath, "utf8");
    expect(content).toMatch(/Faucet Funding/i);
    expect(content).toMatch(/friendbot\.stellar\.org/i);
  });

  test("contains mock USDC deployment section", async () => {
    const content = await fs.readFile(docPath, "utf8");
    expect(content).toMatch(/Mock USDC Deployment/i);
    expect(content).toMatch(/mock_usdc\.wasm/i);
  });
});
