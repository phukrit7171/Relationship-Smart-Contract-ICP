// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryRouter,
  useParams,
} from "react-router-dom";
import JoinWithCode from "./JoinWithCode";

function OpenedInvite() {
  const { code } = useParams();
  return <p>Opened {code}</p>;
}

function renderJoin() {
  return render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: "/join", element: <JoinWithCode /> },
          { path: "/invite/:code", element: <OpenedInvite /> },
        ],
        { initialEntries: ["/join"] },
      )}
    />,
  );
}

afterEach(cleanup);

describe("JoinWithCode", () => {
  it("accepts a full invite link without truncating it", async () => {
    renderJoin();
    const input = screen.getByLabelText(/Invite code or link/i);
    expect(input.maxLength).toBe(512);

    fireEvent.change(input, {
      target: {
        value: "https://aaaaa-aa.icp.net/#/invite/abcde-fghjk",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Open the invitation/i }));

    expect(await screen.findByText("Opened ABCDEFGHJK")).toBeTruthy();
  });

  it("does not truncate a code separated by spaces", () => {
    renderJoin();
    fireEvent.change(screen.getByLabelText(/Invite code or link/i), {
      target: { value: "A B C D E F G H J K" },
    });

    expect(screen.getByRole("button", { name: /Open the invitation/i }).disabled).toBe(false);
    expect(screen.getByText(/Reads as ABCDE-FGHJK/)).toBeTruthy();
  });
});
