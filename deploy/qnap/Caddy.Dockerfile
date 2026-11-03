FROM caddy:2.11.7-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
# The official binary carries cap_net_bind_service. It cannot execute with
# an empty capability bounding set. This service only listens on port 62187.
RUN getcap /usr/bin/caddy && setcap -r /usr/bin/caddy && getcap /usr/bin/caddy
USER 1000:1000
