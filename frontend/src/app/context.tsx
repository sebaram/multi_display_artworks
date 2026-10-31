import { createContext, useContext } from "react";
import type { SessionRead } from "../api/types";
export const SessionContext = createContext<{
  session: SessionRead;
  reload: () => Promise<void>;
}>({
  session: { authenticated: false, is_admin: false },
  reload: async () => {},
});
export const useSession = () => useContext(SessionContext);
