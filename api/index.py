"""Vercel entry point for the Gamers Oasis API."""

from server import StoreHandler, initialize_database

initialize_database()


class Handler(StoreHandler):
    """Expose the existing HTTP API through Vercel's Python runtime."""

    pass
