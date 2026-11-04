import { CanvasArea } from "./canvas-area";
import { Toolbar } from "./toolbar";
import { LeftSidebar } from "./left-sidebar";
import { RightSidebar } from "./right-sidebar";
import { PagesBar } from "./pages-bar";
import { ObjectContextMenu } from "./object-context-menu";
import { ContextToolbar } from "./context-toolbar";
import { SelectionToolbar } from "./selection-toolbar";
import { SidePanel } from "./side-panel";
import { EditorUIProvider } from "./editor-ui";

export function Editor() {
  return (
    <EditorUIProvider>
      <div class="flex flex-col h-full w-full">
        <Toolbar />
        <div class="flex flex-1 min-h-0">
          <LeftSidebar />
          <div class="flex-1 flex flex-col min-w-0">
            <ContextToolbar />
            <div class="relative flex-1 flex flex-col min-h-0">
              <CanvasArea />
              <SidePanel />
            </div>
            <PagesBar />
          </div>
          <RightSidebar />
        </div>
        <SelectionToolbar />
        <ObjectContextMenu />
      </div>
    </EditorUIProvider>
  );
}
