export interface PostRecord {
  platformPostId: string;
  url: string;
  writtenAt: Date;
  commentCnt: number;
}

export interface Repo {
  findPost(platformPostId: string): Promise<PostRecord | null>;
  insertPost(
    meta: import("../core/crawlers/dcinside/types").DCPost
  ): Promise<void>;
  updatePostCommentCount(
    platformPostId: string,
    commentCnt: number
  ): Promise<void>;
  recentPostsSince(date: Date): Promise<PostRecord[]>;
  hasComment(platformCommentId: string): Promise<boolean>;
  bulkInsertComments(
    comments: Array<{
      platformCommentId: string;
      postPlatformId: string;
      writerId: string | null;
      writer: string;
      writerIp: string | null;
      contents: string;
      url: string;
      galleryKey: string; // "G&galleryId" | "M&galleryId" | "MI&galleryId"
      writtenAt: Date;
    }>
  ): Promise<void>;
}
