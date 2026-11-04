import { render } from "preact";
import * as fabric from "fabric";
import { App } from "./app";
import { initTheme } from "./components/theme-toggle";
import "./styles.css";

initTheme();

// Fabric v6 drops unknown properties on serialize, and `canvas.toJSON()` takes
// no argument list any more. Registering `fieldName` here is what makes it
// survive every save and reload, without touching the toJSON call sites.
fabric.FabricObject.customProperties = ["fieldName", "isCutout", "altText", "subjectId", "cutoutOf", "lumioLook", "lumioAdjust"];

render(<App />, document.getElementById("app")!);
