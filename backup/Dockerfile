FROM alpine:3.20
RUN apk add --no-cache bash postgresql16-client rclone tzdata
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh
CMD ["/backup.sh"]
