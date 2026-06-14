# Aerial Icecast image — built from our own config so secrets come from env.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends icecast2 gettext-base ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/icecast2 && chmod 0777 /var/log/icecast2

COPY icecast.xml.template /etc/icecast2/icecast.xml.template
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
