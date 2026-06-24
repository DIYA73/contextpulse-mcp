import { Module } from "@nestjs/common";
import { SessionsController } from "../controllers/sessions.controller.js";
import { RunsController } from "../controllers/runs.controller.js";
import { AlertsController } from "../controllers/alerts.controller.js";
import { EventsGateway } from "../gateways/events.gateway.js";

@Module({ controllers: [SessionsController, RunsController, AlertsController], providers: [EventsGateway] })
export class AppModule {}
