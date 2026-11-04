"""Vercel entry point for the Gamers Oasis API."""

from server import app, initialize_database

initialize_database()
