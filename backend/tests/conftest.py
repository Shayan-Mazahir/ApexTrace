import os
import tempfile

# Keep the suite hermetic: results cached by a test run go to a throwaway
# directory, never into (or out of) the developer's backend/.cache.
os.environ.setdefault("LIMITLAB_CACHE_DIR", tempfile.mkdtemp(prefix="limitlab-cache-"))
# ...and no background replay pre-warming whenever a TestClient starts the app.
os.environ.setdefault("LIMITLAB_PREWARM", "0")
# ...and leaderboard entries posted by tests never land in backend/.data.
os.environ.setdefault("LIMITLAB_DATA_DIR", tempfile.mkdtemp(prefix="limitlab-data-"))
