import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { tracker } from "../../shared.js";
import type { ToolCallEvent } from "../../types/index.js";
import type { WsEvent } from "../dto/index.js";

@WebSocketGateway({ cors: { origin: process.env["DASHBOARD_ORIGIN"] ?? "http://localhost:3001", credentials: true }, namespace: "/events" })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  afterInit(): void {
    this.logger.log("WebSocket gateway initialized on /events");
    this.bindTrackerEvents();
  }
  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    client.emit("connected", { timestamp: new Date() });
  }
  handleDisconnect(client: Socket): void { this.logger.log(`Client disconnected: ${client.id}`); }

  emitRunStarted(runId: string, sessionId: string, label: string | null): void {
    this.broadcast({ event: "run_started", data: { runId, sessionId, label } });
  }
  emitRunEnded(runId: string): void { this.broadcast({ event: "run_ended", data: { runId } }); }

  private bindTrackerEvents(): void {
    tracker.on("event", (event: ToolCallEvent) => {
      if (event.event === "budget_warning") {
        this.broadcast({ event: "budget_warning", data: { runId: event.data.runId, budget: { used: event.data.budget.used, limit: event.data.budget.limit, percentUsed: parseFloat(event.data.budget.percentUsed.toFixed(2)) } } });
      }
      if (event.event === "budget_critical") {
        this.broadcast({ event: "budget_critical", data: { runId: event.data.runId, budget: { used: event.data.budget.used, limit: event.data.budget.limit, percentUsed: parseFloat(event.data.budget.percentUsed.toFixed(2)) } } });
      }
      if (event.event === "loop_detected") {
        this.broadcast({ event: "loop_detected", data: event.data });
      }
    });
  }
  private broadcast(event: WsEvent): void { if (this.server) { this.server.emit(event.event, event.data); } }
}
