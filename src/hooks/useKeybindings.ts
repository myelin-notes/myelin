import { useEffect } from "react";
import { keybindings, ActionBinding } from "@/lib/keybindings";

export function useKeybindings(bindings: ActionBinding[]) {
    useEffect(() => keybindings.register(bindings), [bindings]);
}
