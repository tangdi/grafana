package main

import (
	"context"
	"os"

	"golang.org/x/sync/errgroup"

	"github.com/yinzhiqiang/grafana/pkg/api"
	"github.com/yinzhiqiang/grafana/pkg/log"
	"github.com/yinzhiqiang/grafana/pkg/login"
	"github.com/yinzhiqiang/grafana/pkg/metrics"
	"github.com/yinzhiqiang/grafana/pkg/models"
	"github.com/yinzhiqiang/grafana/pkg/plugins"
	"github.com/yinzhiqiang/grafana/pkg/services/alerting"
	"github.com/yinzhiqiang/grafana/pkg/services/cleanup"
	"github.com/yinzhiqiang/grafana/pkg/services/eventpublisher"
	"github.com/yinzhiqiang/grafana/pkg/services/notifications"
	"github.com/yinzhiqiang/grafana/pkg/services/search"
	"github.com/yinzhiqiang/grafana/pkg/setting"
	"github.com/yinzhiqiang/grafana/pkg/social"
)

func NewGrafanaServer() models.GrafanaServer {
	rootCtx, shutdownFn := context.WithCancel(context.Background())
	childRoutines, childCtx := errgroup.WithContext(rootCtx)

	return &GrafanaServerImpl{
		context:       childCtx,
		shutdownFn:    shutdownFn,
		childRoutines: childRoutines,
		log:           log.New("server"),
	}
}

type GrafanaServerImpl struct {
	context       context.Context
	shutdownFn    context.CancelFunc
	childRoutines *errgroup.Group
	log           log.Logger

	httpServer *api.HttpServer
}

func (g *GrafanaServerImpl) Start() {
	go listenToSystemSignals(g)

	writePIDFile()
	initRuntime()
	initSql()
	metrics.Init()
	search.Init()
	login.Init()
	social.NewOAuthService()
	eventpublisher.Init()
	plugins.Init()

	// init alerting
	if setting.AlertingEnabled && setting.ExecuteAlerts {
		engine := alerting.NewEngine()
		g.childRoutines.Go(func() error { return engine.Run(g.context) })
	}

	// cleanup service
	cleanUpService := cleanup.NewCleanUpService()
	g.childRoutines.Go(func() error { return cleanUpService.Run(g.context) })

	if err := notifications.Init(); err != nil {
		g.log.Error("Notification service failed to initialize", "erro", err)
		g.Shutdown(1, "Startup failed")
		return
	}

	g.startHttpServer()
}

func (g *GrafanaServerImpl) startHttpServer() {
	g.httpServer = api.NewHttpServer()

	err := g.httpServer.Start(g.context)

	if err != nil {
		g.log.Error("Fail to start server", "error", err)
		g.Shutdown(1, "Startup failed")
		return
	}
}

func (g *GrafanaServerImpl) Shutdown(code int, reason string) {
	g.log.Info("Shutdown started", "code", code, "reason", reason)

	err := g.httpServer.Shutdown(g.context)
	if err != nil {
		g.log.Error("Failed to shutdown server", "error", err)
	}

	g.shutdownFn()
	err = g.childRoutines.Wait()

	g.log.Info("Shutdown completed", "reason", err)
	log.Close()
	os.Exit(code)
}
