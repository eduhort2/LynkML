const cfg = window.LYNK_CONFIG;
const configurationReady = Boolean(
  cfg?.supabaseUrl &&
  cfg?.supabaseAnonKey &&
  !cfg.supabaseUrl.includes("SEU-PROJETO") &&
  !cfg.supabaseAnonKey.includes("SUA_CHAVE")
);
const client = configurationReady
  ? supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
  : null;
let currentUser = null;
let pendingFactor = null;
const $ = (id) => document.getElementById(id);
const show = (id) => ["login","mfa","portal"].forEach(x => $(x).classList.toggle("hidden", x !== id));

async function afterLogin() {
  const { data: { user } } = await client.auth.getUser();
  currentUser = user;
  const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const { data } = await client.auth.mfa.listFactors();
    pendingFactor = data.totp[0];
    show("mfa");
    return;
  }
  show("portal");
  $("user-email").textContent = user.email;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
  $("admin-nav").classList.toggle("hidden", profile?.role !== "admin");
  await loadTasks();
}

$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const message = $("login-message");
  if (!configurationReady) {
    message.textContent = "Configure a Project URL e a chave pública anon no arquivo config.js e publique novamente.";
    return;
  }
  message.textContent = "Entrando...";
  try {
    const { error } = await client.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
    message.textContent = error?.message || "";
    if (!error) afterLogin();
  } catch (error) {
    message.textContent = `Falha ao conectar com o Supabase: ${error.message}`;
  }
});

$("mfa-form").addEventListener("submit", async e => {
  e.preventDefault();
  const { data: challenge, error } = await client.auth.mfa.challenge({ factorId: pendingFactor.id });
  if (!error) {
    const result = await client.auth.mfa.verify({ factorId: pendingFactor.id, challengeId: challenge.id, code: $("mfa-code").value });
    $("mfa-message").textContent = result.error?.message || "";
    if (!result.error) afterLogin();
  }
});

document.querySelectorAll("nav button").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x => x.classList.add("hidden"));
  button.classList.add("active");
  $(`${button.dataset.view}-view`).classList.remove("hidden");
  $("view-title").textContent = button.textContent;
}));

async function loadTasks() {
  const { data = [] } = await client.from("tasks").select("*").order("created_at", { ascending: false }).limit(100);
  $("pending-count").textContent = data.filter(x => x.status === "pending").length;
  $("running-count").textContent = data.filter(x => x.status === "running").length;
  $("done-count").textContent = data.filter(x => x.status === "completed").length;
  const html = data.map(x => `<div class="task"><span><b>${x.task_type}</b><br><small>${x.status} · ${new Date(x.created_at).toLocaleString()}</small></span><small>${x.progress || 0}%</small></div>`).join("") || "<p>Nenhuma tarefa.</p>";
  $("task-list").innerHTML = html;
  $("recent-tasks").innerHTML = html;
}

$("task-form").addEventListener("submit", async e => {
  e.preventDefault();
  let payload = { notes: $("task-payload").value };
  try { if ($("task-payload").value.trim().startsWith("{")) payload = JSON.parse($("task-payload").value); } catch {}
  const { error } = await client.from("tasks").insert({ task_type: $("task-type").value, payload, created_by: currentUser.id });
  if (error) alert(error.message); else loadTasks();
});

$("enroll-mfa").addEventListener("click", async () => {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "LYNK OS" });
  if (error) return alert(error.message);
  $("mfa-enroll-result").innerHTML = `${data.totp.qr_code}<p>Após escanear, saia e entre novamente para confirmar o código.</p>`;
});

$("create-user-form").addEventListener("submit", async e => {
  e.preventDefault();
  const { data, error } = await client.functions.invoke("create-user", { body: { name: $("new-name").value, email: $("new-email").value, password: $("new-password").value } });
  $("create-user-message").textContent = error?.message || data?.message || "Usuário criado.";
});

$("logout").addEventListener("click", async () => { await client.auth.signOut(); show("login"); });
if (configurationReady) {
  client.auth.getSession()
    .then(({ data }) => data.session ? afterLogin() : show("login"))
    .catch(() => show("login"));
} else {
  $("login-message").textContent = "Portal ainda não conectado ao Supabase. Preencha o arquivo config.js.";
  show("login");
}
