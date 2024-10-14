ARG PG_TAG=16-bookworm
ARG PG_MAJOR=16
FROM postgres:${PG_TAG}
MAINTAINER Quinn Hart <qjhart@ucdavis.edu>

RUN apt-get update \
	&& apt-get install -y build-essential git-core \
	  postgresql-server-dev-$PG_MAJOR \
    curl less \
    pkg-config liburiparser-dev \
#  libv8-dev postgresql-$PG_MAJOR-plv8 \
  && rm -rf /var/lib/apt/lists/*

# From https://github.com/freebsd/freebsd-ports/commit/68436150c0bbed44dec6393a310a9695cb869b89#diff-b2c58e8c6319d50a0efd772ca7e4c53c5fdc659a80681834520d522962e330a3
COPY uri.c.patch /tmp

#RUN git clone
RUN git clone https://github.com/petere/pguri.git /pguri && \
    cd /pguri && patch < /tmp/uri.c.patch && \
    make && \
    make install


# Put at end to stop remaking everytime :)
COPY initdb.d/ /docker-entrypoint-initdb.d/
