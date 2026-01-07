package com.deehain.smp.networkbridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import me.clip.placeholderapi.PlaceholderAPI;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.*;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.logging.Level;

public class NetworkBridgePlugin extends JavaPlugin implements Listener {

    private HttpServer httpServer;
    private ExecutorService httpExecutor;
    private boolean debugMode = false;
    private boolean alwaysRunTeamCommands = false;
    private boolean disableBetterTeamsApi = false;
    private boolean kickAndUnwhitelistOnRemove = false;
    private boolean unwhitelistOnRemove = false;
    private boolean whitelistOnlyMode = false;

    // Queue of team changes that still need to be applied in-game
    private final List<QueuedTeamChange> queuedChanges = Collections.synchronizedList(new ArrayList<>());
    private File queueFile;

    private final Map<String, List<PendingTeamAction>> pendingTeamActions = new HashMap<>();
    private int pendingTaskId = -1;

    private int queuedChangesTaskId = -1;

    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        this.disableBetterTeamsApi = getConfig().getBoolean("disable-betterteams-api", false);
        this.alwaysRunTeamCommands = getConfig().getBoolean("always-run-team-commands", false);
        this.kickAndUnwhitelistOnRemove = getConfig().getBoolean("kick-and-unwhitelist-on-remove", false);
        this.unwhitelistOnRemove = getConfig().getBoolean("unwhitelist-on-remove", false);
        this.whitelistOnlyMode = getConfig().getBoolean("whitelist-only-mode", false);
        if (!getDataFolder().exists() && !getDataFolder().mkdirs()) {
            getLogger().warning("Could not create plugin data folder: " + getDataFolder());
        }
        this.queueFile = new File(getDataFolder(), "queued-team-changes.json");
        loadQueuedChanges();

        Bukkit.getPluginManager().registerEvents(this, this);

        startHttpServer();
        startQueuedChangesTask();
        getLogger().info("NetworkBridgePlugin enabled.");
    }

    @Override
    public void onDisable() {
        stopHttpServer();
        cancelPendingTask();
        cancelQueuedChangesTask();
        saveQueuedChanges();
        getLogger().info("NetworkBridgePlugin disabled.");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        processQueuedChangesForPlayer(player.getUniqueId(), player.getName());
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("mcpbridge")) {
            return false;
        }

        if (args.length > 0 && args[0].equalsIgnoreCase("reload")) {
            if (!sender.hasPermission("mcpbridge.reload")) {
                sender.sendMessage("§cYou do not have permission to do that.");
                return true;
            }
            reloadConfig();
            this.disableBetterTeamsApi = getConfig().getBoolean("disable-betterteams-api", false);
            this.alwaysRunTeamCommands = getConfig().getBoolean("always-run-team-commands", false);
            this.kickAndUnwhitelistOnRemove = getConfig().getBoolean("kick-and-unwhitelist-on-remove", false);
            this.unwhitelistOnRemove = getConfig().getBoolean("unwhitelist-on-remove", false);
            this.whitelistOnlyMode = getConfig().getBoolean("whitelist-only-mode", false);
            restartHttpServer();
            sender.sendMessage("§aMC Plugin Bridge config reloaded.");
            return true;
        }
        
        if (args.length > 0 && args[0].equalsIgnoreCase("debug")) {
            if (!sender.hasPermission("mcpbridge.debug")) {
                sender.sendMessage("§cYou do not have permission to do that.");
                return true;
            }
            debugMode = !debugMode;
            sender.sendMessage("§aDebug mode " + (debugMode ? "§aENABLED" : "§cDISABLED"));
            return true;
        }

        sender.sendMessage("§eUsage: /" + label + " <reload|debug>");
        return true;
    }

    private void startHttpServer() {
        stopHttpServer();

        String listenIp = getConfig().getString("listen-ip", "0.0.0.0");
        int listenPort = getConfig().getInt("listen-port", 8123);
        String authToken = getConfig().getString("auth-token", "");

        try {
            InetAddress address = InetAddress.getByName(listenIp);
            httpServer = HttpServer.create(new InetSocketAddress(address, listenPort), 0);
        } catch (IOException e) {
            getLogger().log(Level.SEVERE, "Failed to bind HTTP server on " + listenIp + ":" + listenPort, e);
            return;
        }

        httpExecutor = Executors.newCachedThreadPool();
        httpServer.setExecutor(httpExecutor);

        httpServer.createContext("/action", new ActionHandler(authToken));

        httpServer.start();
        getLogger().info("HTTP listener started on " + listenIp + ":" + listenPort + " at /action");
    }

    private void restartHttpServer() {
        stopHttpServer();
        startHttpServer();
    }

    private void stopHttpServer() {
        if (httpServer != null) {
            try {
                httpServer.stop(0);
            } catch (Exception ignored) {
            }
            httpServer = null;
        }
        if (httpExecutor != null) {
            httpExecutor.shutdownNow();
            httpExecutor = null;
        }
    }

    private void startQueuedChangesTask() {
        if (queuedChangesTaskId != -1) {
            Bukkit.getScheduler().cancelTask(queuedChangesTaskId);
        }
        // Run every 30 seconds
        queuedChangesTaskId = Bukkit.getScheduler().scheduleSyncRepeatingTask(this, this::processQueuedChangesForOnlinePlayers, 20L * 30, 20L * 30);
    }

    private void cancelQueuedChangesTask() {
        if (queuedChangesTaskId != -1) {
            Bukkit.getScheduler().cancelTask(queuedChangesTaskId);
            queuedChangesTaskId = -1;
        }
    }

    private void loadQueuedChanges() {
        queuedChanges.clear();
        if (queueFile == null || !queueFile.exists()) {
            return;
        }
        try (Reader reader = new InputStreamReader(new FileInputStream(queueFile), StandardCharsets.UTF_8)) {
            QueuedTeamChange[] arr = gson.fromJson(reader, QueuedTeamChange[].class);
            if (arr != null) {
                Collections.addAll(queuedChanges, arr);
            }
        } catch (Exception e) {
            getLogger().log(Level.WARNING, "Failed to load queued team changes from JSON.", e);
        }
    }

    private void saveQueuedChanges() {
        if (queueFile == null) return;
        // Write to disk off the main thread to avoid blocking the server tick.
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try (Writer writer = new OutputStreamWriter(new FileOutputStream(queueFile), StandardCharsets.UTF_8)) {
                synchronized (queuedChanges) {
                    gson.toJson(queuedChanges, writer);
                }
            } catch (Exception e) {
                getLogger().log(Level.WARNING, "Failed to save queued team changes to JSON.", e);
            }
        });
    }

    private void queueTeamChange(String playerName, String streamer, String actionType) {
        QueuedTeamChange change = new QueuedTeamChange(playerName, streamer, actionType, System.currentTimeMillis());
        synchronized (queuedChanges) {
            queuedChanges.add(change);
        }
        if (debugMode) {
            getLogger().info("[DEBUG] Queued team change for offline player: " + playerName + " (streamer=" + streamer + ", action=" + actionType + ")");
        }
        saveQueuedChanges();
    }

    private void processQueuedChangesForPlayer(UUID uuid, String playerName) {
        if (uuid == null && (playerName == null || playerName.isEmpty())) return;

        List<QueuedTeamChange> toApply = new ArrayList<>();
        synchronized (queuedChanges) {
            for (QueuedTeamChange change : queuedChanges) {
                if (change.applied) continue;
                if (change.playerName.equalsIgnoreCase(playerName)) {
                    toApply.add(change);
                }
            }
        }

        if (toApply.isEmpty()) return;

        for (QueuedTeamChange change : toApply) {
            if (debugMode) {
                getLogger().info("[DEBUG] Applying queued change for player join: " + change.playerName + " (streamer=" + change.streamer + ", action=" + change.actionType + ")");
            }
            handleActionAsync(change.playerName, change.streamer, change.actionType);
            change.applied = true;
        }

        saveQueuedChanges();
    }

    private void processQueuedChangesForOnlinePlayers() {
        if (queuedChanges.isEmpty()) return;

        for (QueuedTeamChange change : queuedChanges) {
            if (change.applied) continue;
            Player online = Bukkit.getPlayerExact(change.playerName);
            if (online != null) {
                if (debugMode) {
                    getLogger().info("[DEBUG] Applying queued change in periodic scan: " + change.playerName + " (streamer=" + change.streamer + ", action=" + change.actionType + ")");
                }
                handleActionAsync(change.playerName, change.streamer, change.actionType);
                change.applied = true;
            }
        }

        saveQueuedChanges();
    }

    private class ActionHandler implements HttpHandler {

        private final String authToken;

        private ActionHandler(String authToken) {
            this.authToken = authToken == null ? "" : authToken;
        }

        @Override
        public void handle(HttpExchange exchange) {
            if (debugMode) {
                getLogger().info("[DEBUG] Incoming request from " + exchange.getRemoteAddress());
                getLogger().info("[DEBUG] Method: " + exchange.getRequestMethod());
            }
            
            try {
                if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                    if (debugMode) {
                        getLogger().warning("[DEBUG] Rejected: Not a POST request");
                    }
                    sendPlain(exchange, 405, "Method Not Allowed");
                    return;
                }

                String body = readBody(exchange.getRequestBody());
                Map<String, String> params = parseFormEncoded(body);
                
                if (debugMode) {
                    getLogger().info("[DEBUG] Request body: " + body);
                    getLogger().info("[DEBUG] Parsed params: " + params.toString());
                }

                if (!authToken.isEmpty()) {
                    String token = params.getOrDefault("token", "");
                    if (debugMode) {
                        getLogger().info("[DEBUG] Checking token: expected=*****, received=" + (token.isEmpty() ? "(none)" : "*****"));
                    }
                    if (!authToken.equals(token)) {
                        getLogger().warning("Received request with invalid token from " + exchange.getRemoteAddress());
                        if (debugMode) {
                            getLogger().warning("[DEBUG] Token mismatch! Authentication failed.");
                        }
                        sendJson(exchange, 401, "{\"ok\":false,\"error\":\"invalid_token\"}");
                        return;
                    }
                    if (debugMode) {
                        getLogger().info("[DEBUG] Token validated successfully");
                    }
                }

                String playerName = params.get("playerName");
                String streamer = params.get("streamer");
                String action = params.getOrDefault("action", "add");

                if (playerName == null || streamer == null) {
                    sendJson(exchange, 400, "{\"ok\":false,\"error\":\"missing_fields\"}");
                    return;
                }

                // Check if this is a test connection
                if ("TestPlayer".equals(playerName) && "TestStreamer".equals(streamer)) {
                    if (debugMode) {
                        getLogger().info("[DEBUG] Test connection detected!");
                    }
                    Bukkit.getScheduler().runTask(NetworkBridgePlugin.this, () -> {
                        Bukkit.broadcastMessage("§a[Bridge] Test connection received successfully!");
                    });
                    sendJson(exchange, 200, "{\"ok\":true,\"message\":\"Test connection successful\"}");
                    return;
                }
                
                if (debugMode) {
                    getLogger().info("[DEBUG] Processing action: " + action + " for player: " + playerName + " (streamer: " + streamer + ")");
                }

                // If the player is online, apply immediately; otherwise, queue for when they join.
                Player online = Bukkit.getPlayerExact(playerName);
                if (online != null) {
                    if (debugMode) {
                        getLogger().info("[DEBUG] Player is online, applying action immediately.");
                    }
                    handleActionAsync(playerName, streamer, action);
                    sendJson(exchange, 200, "{\"ok\":true,\"applied\":true,\"queued\":false}");
                } else {
                    if (debugMode) {
                        getLogger().info("[DEBUG] Player is offline, queuing action for later.");
                    }
                    queueTeamChange(playerName, streamer, action);
                    sendJson(exchange, 200, "{\"ok\":true,\"applied\":false,\"queued\":true}");
                }

            } catch (Exception ex) {
                getLogger().log(Level.SEVERE, "Error handling /action request", ex);
                try {
                    sendJson(exchange, 500, "{\"ok\":false,\"error\":\"internal_error\"}");
                } catch (IOException ignored) {
                }
            } finally {
                try {
                    exchange.close();
                } catch (Exception ignored) {
                }
            }
        }

        private String readBody(InputStream is) throws IOException {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int len;
            while ((len = is.read(buffer)) != -1) {
                baos.write(buffer, 0, len);
            }
            return baos.toString(StandardCharsets.UTF_8);
        }

        private Map<String, String> parseFormEncoded(String body) {
            Map<String, String> map = new HashMap<>();
            if (body == null || body.isEmpty()) return map;

            String[] pairs = body.split("&");
            for (String pair : pairs) {
                int idx = pair.indexOf('=');
                if (idx <= 0) continue;
                String key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8);
                String value = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
                map.put(key, value);
            }
            return map;
        }

        private void sendJson(HttpExchange exchange, int status, String json) throws IOException {
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }

        private void sendPlain(HttpExchange exchange, int status, String text) throws IOException {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    private void handleActionAsync(String playerName, String streamer, String actionType) {
        // Still try to resolve a UUID internally for PlaceholderAPI and BetterTeams,
        // but all external communication and config use Minecraft usernames only.
        OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayerIfCached(playerName);
        if (offlinePlayer == null) {
            // Try online players
            Player onlinePlayer = Bukkit.getPlayerExact(playerName);
            if (onlinePlayer != null) {
                offlinePlayer = onlinePlayer;
            }
        }
        
        UUID uuid = offlinePlayer != null ? offlinePlayer.getUniqueId() : null;
        final String finalStreamer = streamer; // use streamer name directly from the website/config
        final UUID finalUuid = uuid;
        List<String> commands = getConfig().getStringList("commands");
        boolean hasCommands = commands != null && !commands.isEmpty();

        boolean papiAvailable = Bukkit.getPluginManager().getPlugin("PlaceholderAPI") != null;

        Bukkit.getScheduler().runTask(this, () -> {
            Player onlinePlayer = finalUuid != null ? Bukkit.getPlayer(finalUuid) : null;

            // Always ensure chosen players are whitelisted BEFORE any BetterTeams logic
            if ("add".equalsIgnoreCase(actionType)) {
                String cmd = "whitelist add " + playerName;
                getLogger().info("Ensuring player is whitelisted: /" + cmd);
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd);
            }

            // Optional: kick + unwhitelist or only unwhitelist on removal
            if ("remove".equalsIgnoreCase(actionType)) {
                if (kickAndUnwhitelistOnRemove) {
                    if (onlinePlayer != null) {
                        String kickCmd = "kick " + playerName + " Removed from team";
                        getLogger().info("Kicking player on team removal: /" + kickCmd);
                        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), kickCmd);
                    }
                    String wlCmd = "whitelist remove " + playerName;
                    getLogger().info("Removing player from whitelist on team removal: /" + wlCmd);
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(), wlCmd);
                } else if (unwhitelistOnRemove) {
                    String wlCmd = "whitelist remove " + playerName;
                    getLogger().info("Removing player from whitelist on team removal (no kick): /" + wlCmd);
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(), wlCmd);
                }
            }

            if (!whitelistOnlyMode) {
                if (hasCommands) {
                    for (String raw : commands) {
                        if (raw == null || raw.trim().isEmpty()) continue;

                        String cmd = raw
                                .replace("%player_name%", playerName)
                                .replace("%streamer%", finalStreamer);

                        // %player_uuid% is optional and only filled if we have one
                        if (cmd.contains("%player_uuid%")) {
                            cmd = cmd.replace("%player_uuid%", finalUuid != null ? finalUuid.toString() : "unknown");
                        }

                        if (papiAvailable && onlinePlayer != null) {
                            try {
                                cmd = PlaceholderAPI.setPlaceholders(onlinePlayer, cmd);
                            } catch (Throwable t) {
                                getLogger().log(Level.WARNING, "Failed to apply PlaceholderAPI placeholders to command: " + raw, t);
                            }
                        }

                        getLogger().info("Dispatching command from web request: /" + cmd);
                        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd);
                    }
                } else {
                    getLogger().warning("No commands configured to run for incoming actions.");
                }
            }

            // BetterTeams integration: streamer -> nation -> /teamadmin add/remove %player% %nation%
            if (!whitelistOnlyMode && !disableBetterTeamsApi) {
                String nation = getNationForStreamer(finalStreamer);
                if (nation != null && !nation.isEmpty() && finalUuid != null) {
                    if ("remove".equalsIgnoreCase(actionType)) {
                        handleTeamRemovalForPlayer(playerName, finalUuid, finalStreamer, nation);
                    } else {
                        handleTeamForPlayer(playerName, finalUuid, finalStreamer, nation);
                    }
                }
            }
        });
    }

    private String getNationForStreamer(String streamer) {
        if (streamer == null || streamer.isEmpty()) return null;
        // streamer-nations now maps streamer IGN directly to nation name
        ConfigurationSection section = getConfig().getConfigurationSection("streamer-nations");
        if (section == null) return null;

        // Try exact key first
        String direct = section.getString(streamer);
        if (direct != null && !direct.isEmpty()) {
            return direct;
        }

        // Case-insensitive lookup
        for (String key : section.getKeys(false)) {
            if (key.equalsIgnoreCase(streamer)) {
                String value = section.getString(key);
                if (value != null && !value.isEmpty()) {
                    return value;
                }
            }
        }
        return null;
    }

    private void handleTeamForPlayer(String playerName, UUID uuid, String streamer, String nation) {
        if (disableBetterTeamsApi) {
            runTeamAddCommand(playerName, nation);
            return;
        }

        if (!doesNationExist(nation)) {
            getLogger().info("Nation '" + nation + "' does not exist yet, queuing add for player " + playerName);
            queuePendingTeamAction(playerName, uuid, streamer, nation);
            return;
        }

        boolean usedApi = false;
        if (uuid != null) {
            usedApi = tryBetterTeamsAdd(playerName, uuid, nation);
        }

        if (!usedApi) {
            // Fallback to configured command if API failed or UUID unavailable
            runTeamAddCommand(playerName, nation);
        }
    }

    private void handleTeamRemovalForPlayer(String playerName, UUID uuid, String streamer, String nation) {
        if (disableBetterTeamsApi) {
            runTeamRemoveCommand(playerName, nation);
            return;
        }

        if (!doesNationExist(nation)) {
            getLogger().info("Nation '" + nation + "' does not exist for removal, skipping team remove for player " + playerName);
            return;
        }

        boolean usedApi = false;
        if (uuid != null) {
            usedApi = tryBetterTeamsRemove(playerName, uuid, nation);
        }

        if (!usedApi) {
            // Fallback to configured command if API failed or UUID unavailable
            runTeamRemoveCommand(playerName, nation);
        }
    }

    private boolean tryBetterTeamsAdd(String playerName, UUID uuid, String nationName) {
        try {
            // Use BetterTeams Team + TeamPlayer + PlayerJoinTeamEvent as per official repo
            Class<?> teamClass = Class.forName("com.booksaw.betterTeams.Team");
            Class<?> teamPlayerClass = Class.forName("com.booksaw.betterTeams.TeamPlayer");
            Class<?> playerRankClass = Class.forName("com.booksaw.betterTeams.PlayerRank");
            Class<?> joinEventClass = Class.forName("com.booksaw.betterTeams.customEvents.PlayerJoinTeamEvent");

            // Team team = Team.getTeam(nationName);
            java.lang.reflect.Method getTeamMethod = teamClass.getMethod("getTeam", String.class);
            Object team = getTeamMethod.invoke(null, nationName);
            if (team == null) {
                if (debugMode) {
                    getLogger().info("[DEBUG] BetterTeams API: team '" + nationName + "' not found");
                }
                return false;
            }

            OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(uuid);
            if (offlinePlayer == null) {
                return false;
            }

            // PlayerRank.DEFAULT
            @SuppressWarnings("unchecked")
            Object defaultRank = Enum.valueOf((Class<Enum>) playerRankClass, "DEFAULT");

            // new TeamPlayer(OfflinePlayer, PlayerRank)
            java.lang.reflect.Constructor<?> tpCtor = teamPlayerClass.getConstructor(OfflinePlayer.class, playerRankClass);
            Object teamPlayer = tpCtor.newInstance(offlinePlayer, defaultRank);

            // new PlayerJoinTeamEvent(Team, TeamPlayer)
            java.lang.reflect.Constructor<?> eventCtor = joinEventClass.getConstructor(teamClass, teamPlayerClass);
            Event event = (Event) eventCtor.newInstance(team, teamPlayer);

            Bukkit.getPluginManager().callEvent(event);
            getLogger().info("BetterTeams API: fired PlayerJoinTeamEvent for '" + playerName + "' in team '" + nationName + "'.");
            return true;
        } catch (ClassNotFoundException e) {
            // API not present, will fall back to commands
            if (debugMode) {
                getLogger().warning("[DEBUG] BetterTeams API classes not found, falling back to commands.");
            }
            return false;
        } catch (Exception e) {
            getLogger().log(Level.WARNING, "Failed to add player '" + playerName + "' to team '" + nationName + "' via BetterTeams API events.", e);
            return false;
        }
    }

    private boolean tryBetterTeamsRemove(String playerName, UUID uuid, String nationName) {
        try {
            Class<?> teamClass = Class.forName("com.booksaw.betterTeams.Team");
            Class<?> teamPlayerClass = Class.forName("com.booksaw.betterTeams.TeamPlayer");
            Class<?> playerRankClass = Class.forName("com.booksaw.betterTeams.PlayerRank");
            Class<?> leaveEventClass = Class.forName("com.booksaw.betterTeams.customEvents.PlayerLeaveTeamEvent");

            java.lang.reflect.Method getTeamMethod = teamClass.getMethod("getTeam", String.class);
            Object team = getTeamMethod.invoke(null, nationName);
            if (team == null) {
                if (debugMode) {
                    getLogger().info("[DEBUG] BetterTeams API: team '" + nationName + "' not found for removal");
                }
                return false;
            }

            OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(uuid);
            if (offlinePlayer == null) {
                return false;
            }

            // PlayerRank.DEFAULT (rank is mostly irrelevant for leave)
            @SuppressWarnings("unchecked")
            Object defaultRank = Enum.valueOf((Class<Enum>) playerRankClass, "DEFAULT");

            java.lang.reflect.Constructor<?> tpCtor = teamPlayerClass.getConstructor(OfflinePlayer.class, playerRankClass);
            Object teamPlayer = tpCtor.newInstance(offlinePlayer, defaultRank);

            java.lang.reflect.Constructor<?> eventCtor = leaveEventClass.getConstructor(teamClass, teamPlayerClass);
            Event event = (Event) eventCtor.newInstance(team, teamPlayer);

            Bukkit.getPluginManager().callEvent(event);
            getLogger().info("BetterTeams API: fired PlayerLeaveTeamEvent for '" + playerName + "' from team '" + nationName + "'.");
            return true;
        } catch (ClassNotFoundException e) {
            if (debugMode) {
                getLogger().warning("[DEBUG] BetterTeams API classes not found for removal, falling back to commands.");
            }
            return false;
        } catch (Exception e) {
            getLogger().log(Level.WARNING, "Failed to remove player '" + playerName + "' from team '" + nationName + "' via BetterTeams API events.", e);
            return false;
        }
    }

    private boolean doesNationExist(String nationName) {
        if (nationName == null || nationName.isEmpty()) return false;

        // If configured, do not block commands based on BetterTeams API checks
        if (alwaysRunTeamCommands) {
            if (debugMode) {
                getLogger().info("[DEBUG] always-run-team-commands=true, skipping BetterTeams API existence check for '" + nationName + "'");
            }
            return true;
        }

        try {
            // Use BetterTeams Team API from docs: Team.getTeam(String)
            Class<?> teamClass = Class.forName("com.booksaw.betterTeams.Team");
            java.lang.reflect.Method getTeamMethod = teamClass.getMethod("getTeam", String.class);
            Object team = getTeamMethod.invoke(null, nationName);
            return team != null;
        } catch (ClassNotFoundException e) {
            // BetterTeams not present or API class not found
            getLogger().warning("BetterTeams API not found (com.booksaw.betterTeams.Team). Cannot verify nation existence.");
            return false;
        } catch (NoSuchMethodException e) {
            getLogger().log(Level.WARNING, "BetterTeams API method getTeam(String) not found.", e);
            return false;
        } catch (Exception e) {
            getLogger().log(Level.WARNING, "Error while checking BetterTeams nation existence for '" + nationName + "'", e);
            return false;
        }
    }

    private void runTeamAddCommand(String playerName, String nation) {
        String template = getConfig().getString("team-add-command", "teamadmin add %player_name% %nation%");
        String cmd = template
                .replace("%player_name%", playerName)
                .replace("%nation%", nation);
        getLogger().info("Dispatching BetterTeams ADD command from web request: /" + cmd);
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd);
    }

    private void runTeamRemoveCommand(String playerName, String nation) {
        String template = getConfig().getString("team-remove-command", "teamadmin remove %player_name% %nation%");
        String cmd = template
                .replace("%player_name%", playerName)
                .replace("%nation%", nation);
        getLogger().info("Dispatching BetterTeams REMOVE command from web request: /" + cmd);
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd);
    }

    private void queuePendingTeamAction(String playerName, UUID uuid, String streamer, String nation) {
        PendingTeamAction action = new PendingTeamAction(playerName, uuid, streamer, nation, System.currentTimeMillis());
        pendingTeamActions.computeIfAbsent(nation, k -> new ArrayList<>()).add(action);

        if (pendingTaskId == -1) {
            // Check every 10 seconds
            pendingTaskId = Bukkit.getScheduler().scheduleSyncRepeatingTask(this, this::processPendingTeamActions, 20L * 10, 20L * 10);
        }
    }

    private void processPendingTeamActions() {
        if (pendingTeamActions.isEmpty()) {
            cancelPendingTask();
            return;
        }

        Iterator<Map.Entry<String, List<PendingTeamAction>>> it = pendingTeamActions.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, List<PendingTeamAction>> entry = it.next();
            String nation = entry.getKey();
            if (!doesNationExist(nation)) {
                continue;
            }

            List<PendingTeamAction> actions = entry.getValue();
            for (PendingTeamAction action : actions) {
                runTeamAddCommand(action.playerName, nation);
            }
            it.remove();
        }

        if (pendingTeamActions.isEmpty()) {
            cancelPendingTask();
        }
    }

    private void cancelPendingTask() {
        if (pendingTaskId != -1) {
            Bukkit.getScheduler().cancelTask(pendingTaskId);
            pendingTaskId = -1;
        }
    }

    private static final class PendingTeamAction {
        private final String playerName;
        private final UUID uuid;
        private final String streamer;
        private final String nation;
        private final long createdAt;

        private PendingTeamAction(String playerName, UUID uuid, String streamer, String nation, long createdAt) {
            this.playerName = playerName;
            this.uuid = uuid;
            this.streamer = streamer;
            this.nation = nation;
            this.createdAt = createdAt;
        }
    }

    private static final class QueuedTeamChange {
        private String playerName;
        private String streamer;
        private String actionType; // "add" or "remove"
        private long createdAt;
        private boolean applied;

        private QueuedTeamChange(String playerName, String streamer, String actionType, long createdAt) {
            this.playerName = playerName;
            this.streamer = streamer;
            this.actionType = actionType;
            this.createdAt = createdAt;
            this.applied = false;
        }
    }
}
