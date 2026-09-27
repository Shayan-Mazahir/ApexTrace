"""Keeps worker-pool processes from outliving the process that started them.

If the server is killed while a pool is busy (Ctrl+C during the start-up
evaluation warm-up is enough), its workers are orphaned mid-job and keep
running for minutes, burning every core the next server start needs. When a
process's parent dies, Linux re-parents it (to init or a subreaper such as
`systemd --user`), so a worker only has to notice that its parent changed.
"""

from __future__ import annotations

import os
import threading
import time

POLL_S = 0.5


def exit_with_parent() -> None:
    """Pool initializer: end this worker as soon as its parent process is gone."""
    parent = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(POLL_S)
            if os.getppid() != parent:
                os._exit(0)  # the parent is gone: nobody will read our results

    threading.Thread(target=watch, name="exit-with-parent", daemon=True).start()
