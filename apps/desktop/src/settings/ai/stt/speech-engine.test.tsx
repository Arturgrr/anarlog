import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSttDevices: vi.fn(),
  forgetSttGpuFailures: vi.fn(),
  restartLocalSttEngine: vi.fn(),
}));

vi.mock("~/stt/gguf", () => ({
  ggufCommands: {
    listSttDevices: mocks.listSttDevices,
    forgetSttGpuFailures: mocks.forgetSttGpuFailures,
  },
}));

vi.mock("~/settings/queries", () => ({
  restartLocalSttEngine: mocks.restartLocalSttEngine,
  setSettingValue: vi.fn(),
}));

vi.mock("~/shared/config", () => ({
  useConfigValue: () => "auto",
}));

import { SpeechEngineSection } from "./speech-engine";

const CPU = {
  id: "cpu",
  name: "CPU",
  kind: "cpu",
  backend: "CPU",
  failed: false,
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SpeechEngineSection />
      </QueryClientProvider>,
    ),
  };
}

describe("SpeechEngineSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forgetSttGpuFailures.mockResolvedValue({ status: "ok", data: null });
    mocks.restartLocalSttEngine.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  test("explains a GPU set aside after a failure and lets Auto try it again", async () => {
    mocks.listSttDevices.mockResolvedValue({
      status: "ok",
      data: [
        {
          id: "vulkan0",
          name: "Radeon 780M",
          kind: "gpu",
          backend: "Vulkan",
          failed: true,
        },
        CPU,
      ],
    });
    renderSection();

    expect(
      await screen.findByText(
        "Auto uses the CPU because Radeon 780M stopped responding.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try GPU again" }));

    await waitFor(() => expect(mocks.restartLocalSttEngine).toHaveBeenCalled());
    expect(mocks.forgetSttGpuFailures).toHaveBeenCalled();
    await waitFor(() => expect(mocks.listSttDevices).toHaveBeenCalledTimes(2));
  });

  test("stays hidden when no GPU backend exists", async () => {
    mocks.listSttDevices.mockResolvedValue({ status: "ok", data: [CPU] });
    const { client, container } = renderSection();

    await waitFor(() =>
      expect(client.getQueryState(["local-stt", "devices"])?.status).toBe(
        "success",
      ),
    );
    expect(container.textContent).toBe("");
  });
});
