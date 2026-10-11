// Recap pour macOS — fenêtre native (WKWebView) autour du serveur Recap local.
// Démarre le serveur Node installé dans ~/Library/Application Support/Recap/app, l'arrête en quittant.
// Compilé par scripts/install-mac-app.sh ; aucune dépendance hors du SDK macOS.

import Cocoa
import WebKit

let support = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent("Library/Application Support/Recap")
let logsDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Recap")
let info = Bundle.main.infoDictionary ?? [:]
let port = Int(info["RecapPort"] as? String ?? "") ?? 3217
let nodePath = info["RecapNodePath"] as? String ?? "/usr/local/bin/node"
let baseURL = URL(string: "http://localhost:\(port)")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var server: Process?
  var attempts = 0

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = true
    web.setValue(false, forKey: "drawsBackground")

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                      backing: .buffered, defer: false)
    window.title = "Recap"
    window.minSize = NSSize(width: 420, height: 560)
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("RecapMain")
    window.makeKeyAndOrderFront(nil)
    showMessage("Démarrage de Recap…", detail: "")

    startServer()
    waitForServer()
  }

  // MARK: Serveur

  func startServer() {
    if isServerUp() { return } // déjà lancé (ex. instance précédente)
    let appDir = support.appendingPathComponent("app")
    let serverJS = appDir.appendingPathComponent("server.js")
    guard FileManager.default.fileExists(atPath: serverJS.path) else {
      showMessage("Recap n'est pas installé", detail: "Relancez scripts/install-mac-app.sh depuis le dossier du projet.")
      return
    }
    try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    let logURL = logsDir.appendingPathComponent("serveur.log")
    if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
    let log = try? FileHandle(forWritingTo: logURL)
    log?.seekToEndOfFile()

    let p = Process()
    p.executableURL = URL(fileURLWithPath: nodePath)
    p.arguments = [serverJS.path]
    p.currentDirectoryURL = appDir
    var env = ProcessInfo.processInfo.environment
    env["NODE_ENV"] = "production"
    env["PORT"] = String(port)
    env["HOSTNAME"] = "127.0.0.1" // joignable uniquement depuis ce Mac
    env["DATABASE_FILE"] = support.appendingPathComponent("data/recap.db").path
    env["UPLOAD_DIR"] = support.appendingPathComponent("uploads").path
    // Réglages facultatifs (SMTP, ANTHROPIC_API_KEY…) : ~/Library/Application Support/Recap/config.env
    if let extra = try? String(contentsOf: support.appendingPathComponent("config.env"), encoding: .utf8) {
      for line in extra.split(separator: "\n") {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
        env[String(t[..<eq])] = String(t[t.index(after: eq)...])
      }
    }
    p.environment = env
    p.standardOutput = log
    p.standardError = log
    do { try p.run(); server = p } catch {
      showMessage("Impossible de démarrer Recap", detail: "Node introuvable (\(nodePath)). Relancez le script d'installation.")
    }
  }

  func isServerUp() -> Bool {
    var req = URLRequest(url: baseURL.appendingPathComponent("login"))
    req.timeoutInterval = 1
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: req) { _, resp, _ in
      ok = (resp as? HTTPURLResponse).map { $0.statusCode < 500 } ?? false
      sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 1.5)
    return ok
  }

  func waitForServer() {
    DispatchQueue.global().async {
      let up = self.isServerUp()
      DispatchQueue.main.async {
        if up { self.web.load(URLRequest(url: baseURL)); return }
        self.attempts += 1
        if let s = self.server, !s.isRunning {
          self.showMessage("Recap s'est arrêté au démarrage", detail: "Détails : ~/Library/Logs/Recap/serveur.log")
          return
        }
        if self.attempts > 120 {
          self.showMessage("Recap ne répond pas", detail: "Détails : ~/Library/Logs/Recap/serveur.log")
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer() }
      }
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    server?.terminate()
    server?.waitUntilExit()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func showMessage(_ title: String, detail: String) {
    let html = """
    <html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font:15px -apple-system;color:#6b6a65;background:#f5f4f0">
    <div style="text-align:center"><div style="font-size:17px;color:#141413;font-weight:600">\(title)</div>
    <div style="margin-top:6px">\(detail)</div></div>
    <style>@media (prefers-color-scheme: dark){body{background:#121211!important;color:#a3a29c!important}
    div div:first-child{color:#f3f2ee!important}}</style></body></html>
    """
    web.loadHTMLString(html, baseURL: nil)
  }

  // MARK: Navigation : liens externes dans le navigateur, téléchargements dans ~/Téléchargements

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, let scheme = url.scheme {
      let external = scheme == "mailto" || scheme == "tel" ||
        ((scheme == "http" || scheme == "https") && url.host != "localhost" && url.host != "127.0.0.1")
      if external { NSWorkspace.shared.open(url); decisionHandler(.cancel); return }
    }
    decisionHandler(action.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
               decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    if disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var dest = dir.appendingPathComponent(suggestedFilename)
    let base = dest.deletingPathExtension().lastPathComponent, ext = dest.pathExtension
    var n = 1
    while FileManager.default.fileExists(atPath: dest.path) {
      n += 1
      dest = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
    }
    completionHandler(dest)
  }

  func downloadDidFinish(_ download: WKDownload) {
    NSSound(named: "Glass")?.play()
  }

  // Liens target="_blank" : même fenêtre (interne) ou navigateur (externe)
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url {
      if url.host == "localhost" || url.host == "127.0.0.1" { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  // MARK: Boîtes de dialogue JavaScript (window.alert / confirm) et choix de fichiers

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message
    a.addButton(withTitle: "Confirmer"); a.addButton(withTitle: "Annuler")
    a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let p = NSOpenPanel()
    p.allowsMultipleSelection = parameters.allowsMultipleSelection
    p.canChooseDirectories = false
    p.beginSheetModal(for: window) { r in completionHandler(r == .OK ? p.urls : nil) }
  }

  // MARK: Menus (copier/coller, recharger, plein écran…)

  func buildMenu() {
    let main = NSMenu()
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
    }
    let app = NSMenu()
    app.addItem(item("À propos de Recap", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""))
    app.addItem(.separator())
    app.addItem(item("Masquer Recap", #selector(NSApplication.hide(_:)), "h"))
    app.addItem(item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
    app.addItem(.separator())
    app.addItem(item("Quitter Recap", #selector(NSApplication.terminate(_:)), "q"))
    let edit = NSMenu(title: "Édition")
    edit.addItem(item("Annuler", Selector(("undo:")), "z"))
    edit.addItem(item("Rétablir", Selector(("redo:")), "z", [.command, .shift]))
    edit.addItem(.separator())
    edit.addItem(item("Couper", #selector(NSText.cut(_:)), "x"))
    edit.addItem(item("Copier", #selector(NSText.copy(_:)), "c"))
    edit.addItem(item("Coller", #selector(NSText.paste(_:)), "v"))
    edit.addItem(item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"))
    let view = NSMenu(title: "Présentation")
    view.addItem(item("Recharger", #selector(reload), "r"))
    view.addItem(item("Précédent", #selector(goBack), "["))
    view.addItem(item("Suivant", #selector(goForward), "]"))
    view.addItem(item("Tableau de bord", #selector(goHome), "d", [.command, .shift]))
    view.addItem(.separator())
    view.addItem(item("Taille réelle", #selector(zoomReset), "0"))
    view.addItem(item("Agrandir", #selector(zoomIn), "+"))
    view.addItem(item("Réduire", #selector(zoomOut), "-"))
    view.addItem(.separator())
    view.addItem(item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
    let win = NSMenu(title: "Fenêtre")
    win.addItem(item("Placer dans le Dock", #selector(NSWindow.miniaturize(_:)), "m"))
    win.addItem(item("Fermer", #selector(NSWindow.performClose(_:)), "w"))
    for (title, menu) in [("Recap", app), ("Édition", edit), ("Présentation", view), ("Fenêtre", win)] {
      let top = NSMenuItem(title: title, action: nil, keyEquivalent: ""); top.submenu = menu; main.addItem(top)
    }
    NSApp.mainMenu = main
    NSApp.windowsMenu = win
  }

  @objc func reload() { web.reload() }
  @objc func goBack() { web.goBack() }
  @objc func goForward() { web.goForward() }
  @objc func goHome() { web.load(URLRequest(url: baseURL)) }
  @objc func zoomReset() { web.pageZoom = 1 }
  @objc func zoomIn() { web.pageZoom = min(web.pageZoom + 0.1, 2) }
  @objc func zoomOut() { web.pageZoom = max(web.pageZoom - 0.1, 0.5) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
