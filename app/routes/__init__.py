def register_routes(app):
    from app.routes.events import events_bp
    from app.routes.redirect import redirect_bp
    from app.routes.urls import urls_bp

    app.register_blueprint(urls_bp)
    app.register_blueprint(redirect_bp)
    app.register_blueprint(events_bp)
