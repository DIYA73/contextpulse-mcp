import { Module } from "@nestjs/common";
import { SessionsController } from "../controllers/sessions.controller.js";
import { RunsController } from "../controllers/runs.controller.js";
import { AlertsController } from "../controllers/alerts.controller.js";
import { DiffController } from "../controllers/diff.controller.js";
import { EventsGateway } from "../gateways/events.gateway.js";
@Module({ controllers: [SessionsController, RunsController, AlertsController, DiffController], providers: [EventsGateway] })
export class AppModule {}
