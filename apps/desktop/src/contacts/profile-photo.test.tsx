import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./shared", () => ({ ContactFacehash: () => <span>No photo</span> }));
vi.mock("./contact-avatar", () => ({
  ContactImage: ({ src }: { src: string }) => <img src={src} alt="Profile" />,
  AvatarUploadButton: ({
    children,
    onUpload,
  }: {
    children: React.ReactNode;
    onUpload: (value: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onUpload("data:image/jpeg;base64,bmV3")}
    >
      {children}Change photo
    </button>
  ),
}));
import { ProfilePhoto } from "./profile-photo";

afterEach(cleanup);

it("keeps a failed photo save available to retry", async () => {
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error("Disk unavailable"))
    .mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <ProfilePhoto
        userId="owner-1"
        name="Ada"
        localPhoto={null}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Change photo/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "data:image/jpeg;base64,bmV3",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(onSave).toHaveBeenNthCalledWith(2, "data:image/jpeg;base64,bmV3");
});
