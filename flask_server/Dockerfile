FROM tiangolo/uwsgi-nginx-flask:python3.8

ENV NGINX_WORKER_PROCESSES auto
ENV STATIC_PATH /app/metaverse/static


COPY ./app /app
COPY ./requirements.txt /var/www/requirements.txt
RUN pip install -r /var/www/requirements.txt
