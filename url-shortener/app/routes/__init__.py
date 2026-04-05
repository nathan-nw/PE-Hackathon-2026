def register_routes(app):
    from app.routes.admin import admin_bp
    from app.routes.test_results import test_results_bp
    from app.routes.urls import urls_bp

    app.register_blueprint(admin_bp)  # /admin/* prefix — no conflict with /<short_code>
    app.register_blueprint(test_results_bp)  # register before urls_bp so /<short_code> doesn't catch /test-results
    app.register_blueprint(urls_bp)
